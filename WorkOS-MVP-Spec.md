# Work OS — Especificación MVP v2

Este documento reemplaza cualquier propuesta anterior. Es la definición vigente del producto. No incluye código.

---

## 1. Crítica final del MVP

El documento está bien pensado — la decisión "capa de atención, no reemplazo de Gmail/CRM" es correcta y el Work Item como unidad central es el acierto principal. Pero **todavía hay sobreingeniería en la forma de cuatro "engines" separados + dos bandejas secundarias + un sistema de tiers**, cuando la mayoría de eso son cálculos derivados de los mismos cuatro o cinco campos de fecha. Si esto se construye como cuatro módulos independientes, el V1 tarda más de lo necesario y hay más superficie para bugs de sincronización entre "engines" que deberían ser, en realidad, funciones puras sobre el mismo Work Item.

La segunda observación: hay campos y conceptos que **no alimentan ningún engine ni ninguna decisión de UI** (Category con subcategorías, Estimated Time inferido por IA, Contact Tier con lógica propia). Si un campo no cambia qué se muestra, dónde se muestra, o con qué prioridad, no gana su lugar en V1.

## 2. Qué más sacaría (o simplificaría)

| Item | Decisión | Por qué |
|---|---|---|
| **Risk Engine como módulo separado** | Fusionar en el Work Item como función `computeRisk()` que reutiliza los mismos campos que el Follow-up Engine | No es un sistema nuevo, es aritmética de fechas sobre `due_date`, `committed_date`, `expected_date`, `last_activity`. Modelarlo como "engine" aparte agrega una capa de sincronización innecesaria. |
| **AI Suggestions + Potential Commitments** | Fusionar en una sola bandeja "Review" con dos badges (`Sugerencia` / `Posible compromiso`) | Ambas son "cosas de confianza no-HIGH que no quiero perder". Dos widgets colapsados en el dashboard es más carga visual que una sola lista con un tag de color. |
| **Estimated Time inferido por IA** | Campo manual opcional con 4 presets (5 / 15 / 30 / 60 min), default vacío | Es el campo con más riesgo de "la IA se equivocó y ahora desconfío del resto". No vale la pena que lo infiera un LLM en V1. |
| **Contact Tier con lógica propia** | Campo manual A/B/C en el Contact, default B, sin motor de asignación automática | Ya lo dijeron "configurable manualmente" — solo asegurando que no se construya nada más que un campo. |
| **Category con subcategorías (16 valores)** | Mantener solo el nivel superior (Comercial / Técnico / Operaciones / Administrativo), sugerido por IA, editable, nunca obligatorio | Ninguna subcategoría alimenta Priority, Risk o Follow-up. Es metadata para filtrar después, no para V1 día 1. Si en 4 semanas de uso se extraña, se agrega. |
| **Blocking** | Boolean manual en el Work Item (`bloquea: sí/no` + texto libre opcional de qué bloquea) | No modelar relación Work Item → Work Item. Es una bandera de contexto, no un grafo de dependencias. |
| **Morning Brief como artefacto separado** | Es literalmente el Dashboard. No hay job de generación ni plantilla propia — es la misma pantalla, mostrada como "primera apertura del día" | Construir un "generador de resumen" aparte del dashboard es duplicar lógica de priorización que ya existe. |
| **Push notifications de vencimientos** | Confirmado fuera de V1 (ya lo tenían así) | Mantenerlo así — es la fuente #1 de sobreingeniería en herramientas de este tipo. |

Todo lo demás del documento (Confidence system, Follow-up Engine, Priority Engine de 4 factores, modelo Source/Context) está bien calibrado para V1 y no lo tocaría.

---

## 3. Arquitectura funcional definitiva

```
┌─────────────┐ ┌──────────────┐ ┌───────────┐ ┌──────────────────┐
│    GMAIL    │ │  CALENDAR    │ │  MANUAL   │ │ WHATSAPP CAPTURE │
│ (poll 5min) │ │ (poll diario)│ │  (input)  │ │ (email alias +   │
│             │ │              │ │           │ │  iOS Shortcut)   │
└──────┬──────┘ └──────┬───────┘ └─────┬─────┘ └────────┬─────────┘
       │               │               │                │
       ▼               │               ▼                ▼
┌─────────────────────────────┐  ┌──────────────────────────────┐
│      INGESTION LAYER        │  │  (Calendar no pasa por acá:   │
│  (adapter por fuente,        │  │   es contexto, no Work Item)  │
│   normaliza a RawMessage)    │  └──────────────────────────────┘
└──────────────┬───────────────┘
               ▼
┌───────────────────────────────┐
│   RULE FILTER (sin LLM)        │  ← descarta newsletters, bulk,
│                                 │     no-reply, promociones
└──────────────┬──────────────────┘
               ▼
┌───────────────────────────────┐
│   AI NORMALIZER (LLM)          │  ← clasifica: ACTION / WAITING /
│   (thread completo + contexto) │     COMMITMENT / INFO / IGNORE
└──────────────┬──────────────────┘     + confidence + rationale
               ▼
┌───────────────────────────────┐
│   WORK ITEM ENGINE             │  ← crea / actualiza / matchea
│   (dedupe + merge)             │     contra Work Items existentes
└──────────────┬──────────────────┘
               ▼
┌───────────────────────────────┐
│   CONTEXT ASSOCIATION          │  ← sugiere Context (thread/
│   (heurístico, no LLM)         │     contacto/empresa/keyword)
└──────────────┬──────────────────┘
               ▼
┌───────────────────────────────┐
│  FOLLOW-UP / RISK (funciones   │  ← aritmética de fechas sobre
│  puras sobre el Work Item)     │     el Work Item, sin estado propio
└──────────────┬──────────────────┘
               ▼
┌───────────────────────────────┐
│   PRIORITY ENGINE (scoring      │  ← determinístico, basado en
│   determinístico + template)   │     reglas, explicable
└──────────────┬──────────────────┘
               ▼
┌───────────────────────────────┐
│         DASHBOARD               │
└───────────────────────────────┘
```

Principio de desacople: cada capa recibe y devuelve datos tipados sin conocer la implementación de la capa anterior. La única capa con IA es el AI Normalizer — todo lo demás (Follow-up, Risk, Priority, Context Association heurístico) es código determinístico. Esto es intencional: **cuantas menos decisiones dependan de un LLM, más fácil es debuggear y confiar en el sistema.**

---

## 4. Modelo de datos V1

```sql
-- Personas y organizaciones
company (id, name, notes, created_at)
contact (id, name, email, phone_e164, company_id, tier CHAR(1) DEFAULT 'B', created_at)

-- Agrupador temático
context (id, title, company_id NULL, notes, created_at)

-- La unidad central
work_item (
  id,
  title,
  context_id NULL,
  company_id NULL,
  contact_id NULL,
  category ENUM('COMERCIAL','TECNICO','OPERACIONES','ADMINISTRATIVO') NULL,
  status ENUM('OPEN','DONE','POSTPONED','DELEGATED','IGNORED') DEFAULT 'OPEN',
  responsible_id NULL REFERENCES contact(id),  -- puede ser el propio usuario
  next_action TEXT NULL,
  waiting_for_what TEXT NULL,
  waiting_for_contact_id NULL REFERENCES contact(id),
  due_date DATE NULL,
  expected_date DATE NULL,
  committed_date DATE NULL,
  follow_up_date DATE NULL,
  postponed_until DATE NULL,
  blocking BOOLEAN DEFAULT FALSE,
  blocking_note TEXT NULL,
  estimated_minutes INT NULL,        -- manual, presets 5/15/30/60
  last_activity_at TIMESTAMPTZ,
  ai_summary TEXT NULL,
  ai_confidence ENUM('HIGH','MEDIUM','LOW') NULL,
  created_at, updated_at
)

-- Relación N:N Work Item ↔ fuente
source_link (
  id,
  work_item_id REFERENCES work_item(id),
  source_type ENUM('GMAIL','WHATSAPP','CALENDAR','MANUAL','ODOO','DRIVE','SLACK','OTHER'),
  external_id TEXT,              -- gmail thread_id, etc.
  external_url TEXT NULL,        -- deep link "Open Original"
  raw_excerpt TEXT NULL,         -- mínimo necesario, no el cuerpo completo
  raw_metadata JSONB NULL,       -- payload crudo del adapter (futuro-proof)
  direction ENUM('INBOUND','OUTBOUND') NULL,
  occurred_at TIMESTAMPTZ,
  created_at
)

-- Bandeja secundaria unificada (fusión AI Suggestions + Potential Commitments)
review_item (
  id,
  kind ENUM('SUGGESTION','POTENTIAL_COMMITMENT'),
  work_item_id NULL REFERENCES work_item(id),  -- null si es "posible nuevo"
  proposed_payload JSONB,        -- lo que se crearía/actualizaría
  source_link_id REFERENCES source_link(id),
  confidence ENUM('MEDIUM','LOW'),
  rationale TEXT,
  status ENUM('PENDING','CREATED','IGNORED') DEFAULT 'PENDING',
  created_at
)

-- Notas manuales y trazabilidad de correcciones (para análisis futuro, sección 26)
note (id, work_item_id, body, created_at)
correction_log (id, work_item_id, field, old_value, new_value, created_at)

-- Cache liviano de eventos del día (evita llamadas repetidas a Calendar)
calendar_event_cache (
  id, external_id, title, start_at, end_at, attendee_emails TEXT[],
  matched_work_item_id NULL, fetched_at
)
```

Notas de diseño:
- `raw_metadata JSONB` en `source_link` es el punto de extensión para Zapia/Odoo futuros — ver sección 15.
- No hay tabla `waiting_for` separada: son columnas del propio Work Item, porque en V1 un Work Item tiene **un solo** waiting activo a la vez (si aparece un segundo waiting relevante, se evalúa si es un Work Item nuevo).
- `correction_log` no implementa aprendizaje automático (regla 26) — solo guarda el historial para revisarlo manualmente más adelante.

---

## 5. Modelo Source / Work Item / Context

- **Source** no es una entidad de negocio, es procedencia. Un Work Item tiene N `source_link`. El canal nunca determina el Context ni el Category.
- **Work Item** es la unidad de seguimiento. Vive independiente de sus fuentes — si se borra un email, el Work Item persiste con su `raw_excerpt`.
- **Context** es un agrupador opcional, liviano (id + title + company). Un Context puede tener N Work Items. En V1 la asociación es: mismo thread → mismo Context si ya existe uno enlazado; si no, heurística (mismo contacto + empresa + keywords del asunto) sugiere un Context existente o "crear nuevo"; el usuario confirma. No hay resolución de entidades con IA más allá de esa sugerencia.

```
Context "Cliente ABC — Trafo 1600 kVA"
 ├── Work Item: Enviar cotización        (sources: Gmail)
 ├── Work Item: Confirmar tensión         (sources: Gmail, WhatsApp)
 └── Work Item: Aprobar plano             (sources: WhatsApp, Manual)
```

---

## 6. Estados y transiciones de Work Item

`status` (ciclo de vida) es independiente de `next_action`/`waiting_for_*` (qué falta hacer). Un Work Item `OPEN` puede tener acción propia, espera de terceros, o ambas cosas a la vez si el AI Normalizer detectó las dos en el mismo thread (regla del punto 10 del brief original).

```
                 (AI confidence HIGH)
   [no existe] ─────────────────────────► OPEN
                 (AI confidence MEDIUM)
   [no existe] ──────────► review_item(PENDING) ──CREATE──► OPEN
                                              └──IGNORE──► (descartado, log)

   OPEN ──DONE────────────────────────────► DONE
   OPEN ──POSTPONE(fecha)──────────────────► POSTPONED ──(llega la fecha)──► OPEN
   OPEN ──DELEGATE(responsible, expected)──► DELEGATED (equivalente a WAITING interno)
   DELEGATED ──(vence expected_date)───────► OPEN (resurge, marcado at-risk)
   OPEN ──IGNORE────────────────────────────► IGNORED
   DONE / IGNORED ──REOPEN─────────────────► OPEN

   Dentro de OPEN, sub-estado por campos:
     waiting_for_what != NULL, next_action == NULL   → se muestra como "esperando"
     next_action != NULL                              → se muestra como "para hacer"
     ambos != NULL                                     → se muestran ambos badges

   Nueva actividad entrante en un Work Item con waiting_for_what != NULL:
     → no cierra automáticamente. Dispara prompt:
        "Parece que recibiste lo que esperabas" → [RECIBIDO] limpia waiting_for_*
                                                  → [SIGUE ESPERANDO] no hace nada
```

`is_at_risk` y `risk_reason` **no son estados**, son propiedades calculadas en cada lectura (ver sección 9) — no se persisten como enum para no desincronizarse del resto de los campos.

---

## 7. Reglas exactas del Normalization Engine

**Paso 1 — Rule Filter (sin LLM, corre siempre primero):**
Descarta sin gastar tokens si: header `List-Unsubscribe` presente, dominio del remitente en lista de bulk conocida, remitente `noreply@`/`no-reply@`/`mailer@`, o el usuario no está en To/Cc directo (solo Bcc masivo). Todo lo demás pasa al AI Normalizer. **Excepción:** estar en Cc nunca es motivo de descarte automático (regla explícita del brief).

**Paso 2 — Input al LLM:**
Thread completo (hasta N mensajes más recientes), cada mensaje etiquetado `INBOUND`/`OUTBOUND` según el header `From` contra las direcciones del usuario, con nombre de participantes y asunto. Si el thread ya tiene un Work Item enlazado, se incluye su estado actual como contexto (para que el modelo entienda "actualización" vs "nuevo asunto").

**Paso 3 — Salida estructurada (JSON Schema forzado, permite múltiples objetos por thread):**
```
[{
  classification: ACTION | WAITING | COMMITMENT | INFO | IGNORE,
  next_action?: string,
  waiting_for_person?: string,
  waiting_for_what?: string,
  expected_date?: date,
  committed_what?: string,
  committed_date?: date,
  confidence: HIGH | MEDIUM | LOW,
  suggested_context?: string,
  suggested_company?: string,
  suggested_contact?: string,
  rationale: string   // frase corta, alimenta el "Why?" de Priority Engine
}]
```

**Paso 4 — Work Item Engine (determinístico):**
- Si el thread ya está enlazado a un Work Item → actualiza campos **solo si** confidence=HIGH y el evento es más reciente que el que originó el valor actual. Si confidence=MEDIUM, no pisa el campo — crea un `review_item(kind=SUGGESTION)` de tipo "actualización sugerida".
- Si no hay Work Item enlazado y confidence=HIGH → busca duplicados por (contact + company + similitud de asunto) antes de crear; si encuentra candidato, sugiere merge en vez de crear uno nuevo.
- Si no hay Work Item enlazado y confidence=MEDIUM → `review_item(kind=SUGGESTION)`, "posible nuevo Work Item".
- **Regla exacta de Potential Commitments (confidence=LOW):** se descarta siempre, **excepto** cuando `classification` es `COMMITMENT` o `ACTION` **y** el mensaje origen es `OUTBOUND` (algo que el usuario mismo escribió). Ese caso puntual genera `review_item(kind=POTENTIAL_COMMITMENT)`. Esta es la regla operativa que evita perder compromisos que el usuario asumió sin darse cuenta, sin llenar la bandeja de ruido de mensajes de terceros poco claros.
- `classification=IGNORE` nunca genera nada, en ningún nivel de confianza.

**Paso 5 — Re-análisis incremental:** cuando llega un mensaje nuevo en un thread ya procesado, no se re-envía el thread completo — se envía el mensaje nuevo + el estado actual extraído como contexto, salvo que el thread no tenga aún Work Item asociado (ahí sí se re-evalúa completo).

---

## 8. Reglas del Follow-up Engine

Funciones puras sobre los campos del Work Item, sin tabla ni estado propio:

- `days_overdue = today - expected_date` (si `expected_date < today` y `status=OPEN` y `waiting_for_what != NULL`).
- Si no hay `expected_date`: usar SLA por defecto configurable (ej. 5 días hábiles desde `last_activity_at`) como umbral "stale", sin marcarlo vencido con fecha falsa.
- `follow_up_date` default = `expected_date` si no se seteó manualmente.
- Aparece en "Waiting For" del dashboard siempre que `waiting_for_what != NULL` y `status=OPEN`.
- Entra a bucket de prioridad (TODAY/DO NOW) solo cuando `follow_up_date <= today` o `days_overdue >= 1`.
- Acción sugerida: `FOLLOW UP` si `days_overdue >= 1`; alternativa siempre disponible: `EXTEND` (reprograma `expected_date` y `follow_up_date`).
- `days_without_activity = today - last_activity_at`, calculado para todo Work Item `OPEN` (no solo waiting), insumo del Risk Engine.

---

## 9. Reglas del Risk Engine

`computeRisk(work_item) → { is_at_risk: bool, reason: string | null }`, evaluado en cada carga del dashboard (es aritmética de fechas, no requiere LLM ni job pesado):

1. **OVERDUE**: `due_date < today` y `status=OPEN` → *"Vencido desde {due_date}"*.
2. **COMMITMENT_AT_RISK**: `committed_date < today` y no hay señal de cumplimiento (no está `DONE` ni se recibió confirmación) → *"Prometiste {committed_what} para {committed_date}"*.
3. **FOLLOWUP_SUGGERIDO**: `waiting_for_what != NULL` y `days_overdue >= 2` (hábiles) → *"Sin respuesta hace {days_overdue} días"*.
4. **CLIENTE_ESPERANDO**: último mensaje del thread es `INBOUND`, hay `next_action` sin resolver, y `days_without_activity >= 1` (hábil) → *"{Contacto} esperando respuesta desde {fecha}"*.
5. **Amplificador BLOCKING**: si `blocking=true`, cualquiera de los anteriores se muestra con severidad alta y el texto agrega *"— bloquea {blocking_note}"*.

Si ninguna regla aplica, `is_at_risk=false` y el bloque "AT RISK" del dashboard muestra estado vacío — nunca se inventa un riesgo (regla explícita del brief: *"no inventar problemas"*).

---

## 10. Diseño del Priority Engine

Determinístico, con score interno (no visible al usuario) y explicación siempre generada por plantilla, no por LLM (más rápido, más barato, 100% consistente):

```
score = deadline_urgency + someone_waiting + contact_tier + blocking_bonus

deadline_urgency:  OVERDUE=100, HOY=80, MAÑANA=50, ESTA_SEMANA=20, sin fecha=0
someone_waiting:   +30 si next_action existe y se originó por mensaje INBOUND
contact_tier:      A=+20, B=+10, C=0
blocking_bonus:    +25 si blocking=true

Buckets:
  DO NOW      → score >= 80  (incluye todo OVERDUE)
  TODAY       → score 40–79
  THIS WEEK   → score 15–39
  CAN WAIT    → score < 15
```

`TODAY` se limita a 5 ítems por regla de presentación (no de datos): si hay más de 5 con score en rango TODAY, se muestran los 5 de mayor score y el resto pasa a THIS WEEK en la UI, no se pierden.

`Why?` se arma con los 2 factores de mayor peso que contribuyeron al score, con plantillas fijas:
*"{Deadline} + Cliente Tier {X} esperando desde {días}"*, *"{Días} atrasado + bloquea {blocking_note}"*, etc. — exactamente el formato pedido en el brief.

---

## 11. Estrategia exacta de Gmail ingestion

- **Scope**: `gmail.readonly` únicamente para V1 (más rápido de aprobar en OAuth consent, menor riesgo). `gmail.labels` opcional si se quiere marcar threads procesados con una etiqueta visible tipo "Work OS ✓" (no obligatorio para el usuario, solo feedback visual de que fue leído).
- **Sync**: **polling cada 5 minutos** vía cron (Vercel Cron), no push/Pub-Sub en V1 — evita configurar un topic de GCP y verificación de dominio solo para un usuario. Se revisita si la latencia de 5 min resulta molesta en uso real.
- **Nivel de trabajo**: se procesa por **thread completo**, no por mensaje individual — cuando el polling detecta un mensaje nuevo en un thread conocido o un thread nuevo, se hace `threads.get(format=full)` y se re-arma la secuencia ordenada INBOUND/OUTBOUND.
- **Dirección**: comparando `From` contra la lista de direcciones/alias del usuario (configurable, por si tiene más de una cuenta).
- **Qué se guarda**: solo lo necesario — `thread_id`, `external_url` (deep link `https://mail.google.com/mail/u/0/#inbox/{thread_id}`), y un `raw_excerpt` corto (ej. últimas 2-3 líneas relevantes), nunca el cuerpo completo replicado. **"Open Original Email" siempre disponible.**
- **Dedupe de threads ya vistos**: tabla `source_link` indexada por `(source_type, external_id)`.

---

## 12. Estrategia exacta de Google Calendar

- **Scope**: `calendar.readonly`.
- **Sync**: fetch de eventos del día vía `events.list(timeMin=hoy 00:00, timeMax=hoy 23:59)` una vez a primera apertura del día + refresh con cache TTL de 15 min en cargas posteriores del dashboard (no hace falta tiempo real).
- **Disponibilidad**: `available_focus_time` = ventana laboral configurable (ej. 09:00–18:00) menos la suma de eventos no declinados que no sean "all-day". Cálculo simple de resta de intervalos — un solo calendario (el primario), sin fusión multi-calendario en V1.
- **Relación con Context**: si el email de algún asistente del evento coincide con el `contact_id` o `company_id` de un Work Item abierto, se muestra ese Context debajo del evento en la lista de Calendar. Es un join simple, no hay IA involucrada.
- **Nada de Meeting Briefs, ni resumen de reunión, ni agenda minuto a minuto** — Calendar aporta únicamente: lista del día + tiempo disponible + relación superficial con Context.

---

## 13. Comparación de alternativas — captura de WhatsApp desde iPhone

| Opción | Velocidad real | Esfuerzo de build | Multiplataforma | Dependencias nuevas |
|---|---|---|---|---|
| **A. iOS Shortcut → HTTPS endpoint propio** | ~2–4s | Medio (1 endpoint autenticado + shortcut) | Solo iPhone | Ninguna (reusa infra propia) |
| **B. Dirección de captura por email** (`capture@` o alias con label en Gmail) | ~8–15s (Share → Mail → enviar) | Prácticamente cero — reutiliza el pipeline de Gmail existente | Cualquier dispositivo (Android, desktop) | Ninguna |
| **C. Bot/canal intermedio (Telegram)** | ~3–5s | Medio-alto (bot, webhook, cuenta de Telegram) | Sí | Agrega una dependencia externa solo como relay |
| **D. Apple Shortcut (Share → HTTPS request)** | ~2–4s | Igual que A — es la misma mecánica | Solo iPhone | Ninguna |

A y D son la misma solución. C no aporta nada que A no resuelva mejor, y suma una dependencia externa (Telegram) sin necesidad real — se descarta.

---

## 14. Recomendación concreta para WhatsApp V1

**Construir ambas, secuenciadas dentro del mismo V1** (no una en V1 y otra en "futuro"):

1. **Día 1 — Opción B (alias de captura por email).** Costo de build casi nulo: es un alias/label de Gmail que entra por el mismo pipeline que ya existe para emails normales, distinguido por remitente/label. Permite empezar a usar la captura de WhatsApp desde el primer día sin escribir un endpoint nuevo. No cumple el objetivo de 2-5s, pero desbloquea el flujo ya.
2. **Fast-follow dentro del mismo V1 — Opción A (Shortcut + endpoint HTTPS).** Es genuinamente poco esfuerzo (una API route con autenticación por token + un Shortcut de iOS) y es la que sí cumple el objetivo explícito de 2-5 segundos, que es un criterio de éxito del producto (sección 33). No tiene sentido dejarla para "después" si el objetivo de velocidad es explícito — sin ella, WhatsApp probablemente no se use lo suficiente.

Ambas alimentan el mismo Normalization Engine y generan el mismo tipo de Work Item — WhatsApp nunca tiene su propio sistema de tareas.

---

## 15. Cómo dejar preparada la integración futura de Zapia sin depender de ella

- `source_type` ya incluye `OTHER` extensible a `ZAPIA` sin migración de esquema (es un enum, se agrega un valor).
- `source_link.raw_metadata JSONB` guarda el payload crudo de cualquier adapter — un futuro adapter de Zapia solo necesita mapear su payload a `{text, contact, timestamp}` antes de entrar al mismo Rule Filter / AI Normalizer. Cero lógica de clasificación específica de WhatsApp.
- Resolución de contacto por **teléfono en formato E.164 desde V1**, incluso en captura manual/Shortcut (pedir el teléfono es opcional pero recomendado) — así, cuando exista un adapter automático, el matching contra contactos existentes funciona retroactivamente sin backfill.
- La Ingestion Layer ya es un adapter por fuente (`GmailAdapter`, `ManualAdapter`, `ShortcutAdapter`) — Zapia sería un cuarto adapter, sin tocar nada aguas abajo.
- Explícitamente **no** se construye ningún puente intermedio (scraping de WhatsApp Web, automatizaciones no oficiales) — si Zapia no ofrece API/webhook oficial, la captura sigue siendo manual (B/A) indefinidamente, sin degradar el resto del sistema.

---

## 16. Diseño del Dashboard

Una sola pantalla, orden fijo, con las dos bandejas secundarias colapsadas por defecto:

1. **Header** — fecha, saludo, resumen de una línea (prioridades / en riesgo / waiting / tiempo disponible), botones Capture y Search.
2. **TODAY** — máx. 5 Work Items, cada uno con: título, empresa/Context, next action, deadline, estimated time (si se cargó), Why, fuente, acciones (Done/Delegate/Postpone/Open Source).
3. **AT RISK** — solo si `is_at_risk=true` en algún Work Item; si no hay, estado vacío explícito ("Sin riesgos detectados"), nunca se fuerza contenido.
4. **WAITING FOR** — lista: persona, qué se espera, fecha esperada, días de atraso, Context, acciones (Follow up/Received/Extend).
5. **CALENDAR TODAY** — lista simple horario + reunión + Context si hay match.
6. **REVIEW** (fusión de AI Suggestions + Potential Commitments) — colapsado, contador visible, dos badges internos (Sugerencia / Posible compromiso), acciones Create/Ignore.

---

## 17. Wireframe textual — Desktop

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Work OS                                          [ Capture ]  [ Search ] │
│  Lunes 10 de agosto · Buenos días, Felipe                                │
│  3 prioridades · 1 en riesgo · 4 esperando · 2h40m disponibles hoy       │
├──────────────────────────────────────────────────────────────────────────┤
│  TODAY                                                                    │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ 1. Cliente A — Trafo 1600 kVA               Deadline: 11:00  [30m]  │ │
│  │    Enviar cotización                                                │ │
│  │    Why: Cliente Tier A + deadline hoy          Source: Gmail        │ │
│  │    [ Done ] [ Delegate ] [ Postpone ] [ Open Source ]                │ │
│  ├────────────────────────────────────────────────────────────────────┤ │
│  │ 2. Proveedor B — Planos 2500 kVA                              [5m]  │ │
│  │    Reclamar planos                                                  │ │
│  │    Why: 3 días atrasado + bloquea producción   Source: WhatsApp     │ │
│  │    [ Done ] [ Delegate ] [ Postpone ] [ Open Source ]                │ │
│  ├────────────────────────────────────────────────────────────────────┤ │
│  │ 3. Cliente C — Consulta técnica                              [15m]  │ │
│  │    Confirmar pérdidas                                               │ │
│  │    Why: Cliente esperando desde ayer            Source: Gmail       │ │
│  │    [ Done ] [ Delegate ] [ Postpone ] [ Open Source ]                │ │
│  └────────────────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────────────┤
│  AT RISK                                                                  │
│  · Proveedor B — Planos 2500 kVA — Vencido, bloquea producción           │
├──────────────────────────────────────────────────────────────────────────┤
│  WAITING FOR                                                             │
│  Carlos — Plano general — Esperado viernes — 2 días atrasado             │
│    [ Follow up ] [ Received ] [ Extend ]                                 │
│  (+ 3 más)                                                                │
├──────────────────────────────────────────────────────────────────────────┤
│  CALENDAR TODAY                                                          │
│  10:00  Cliente D                                                        │
│  13:30  Reunión interna                                                  │
│  16:00  Proveedor E                                                      │
├──────────────────────────────────────────────────────────────────────────┤
│  ▸ REVIEW (6)                                          [colapsado]      │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 18. Wireframe textual — Mobile

```
┌───────────────────────┐
│ Work OS        [ + ]  │
│ Lun 10 ago             │
│ 3 · 1⚠ · 4⏳ · 2h40m   │
├───────────────────────┤
│ TODAY                 │
│ ┌───────────────────┐ │
│ │ Cliente A          │ │
│ │ Enviar cotización  │ │
│ │ 11:00 · 30m        │ │
│ │ [Done][⋯]          │ │
│ └───────────────────┘ │
│ ┌───────────────────┐ │
│ │ Proveedor B        │ │
│ │ Reclamar planos    │ │
│ │ ⚠ 3d atrasado      │ │
│ │ [Done][⋯]          │ │
│ └───────────────────┘ │
│  (+ 1 más)             │
├───────────────────────┤
│ AT RISK (1)      ▸    │
├───────────────────────┤
│ WAITING FOR (4)  ▸    │
├───────────────────────┤
│ CALENDAR         ▸    │
│ 10:00 Cliente D        │
├───────────────────────┤
│ REVIEW (6)       ▸    │
└───────────────────────┘
```

La captura rápida (`[ + ]`) abre directamente un input de texto libre en foco, sin pantalla intermedia — mismo principio de "2-5 segundos" que WhatsApp.

---

## 19. User flows completos

**Morning Review**
1. Usuario abre Work OS (primera vez en el día) → Dashboard se muestra ya con el resumen de header como "Morning Brief" (misma pantalla, sin generación separada).
2. Escanea TODAY (≤5), AT RISK, WAITING FOR, Calendar — objetivo: <10s para entender el día.
3. Opcionalmente expande REVIEW si tiene tiempo.

**Nuevo email**
1. Polling de Gmail (cada 5 min) detecta thread nuevo/actualizado.
2. Rule Filter descarta si es bulk/newsletter.
3. AI Normalizer clasifica → uno o más objetos de clasificación.
4. Work Item Engine crea/actualiza (HIGH) o genera `review_item` (MEDIUM) o `review_item POTENTIAL_COMMITMENT` (LOW + OUTBOUND + ACTION/COMMITMENT) o descarta (LOW resto / IGNORE).
5. Si actualiza un Work Item existente con waiting activo y el mensaje es INBOUND del contacto esperado → dispara prompt "¿Recibiste lo que esperabas?" en vez de pisar el estado.

**Nuevo WhatsApp capturado**
1. Usuario comparte mensaje vía Shortcut (o reenvía a alias de email).
2. Llega a Ingestion Layer como `RawMessage{source=WHATSAPP}`.
3. Mismo Rule Filter + AI Normalizer + Work Item Engine que Gmail.
4. Resultado idéntico en forma a un Work Item creado desde email.

**Captura manual**
1. Usuario abre input rápido, escribe en lenguaje natural.
2. AI Normalizer (mismo motor) extrae type/next_action/waiting_for/fecha.
3. Se muestra un preview editable de 1 pantalla (no múltiples campos obligatorios) → Confirmar crea el Work Item directo en OPEN (no pasa por review_item, porque es intención directa del usuario, no inferencia).

**Waiting vencido**
1. Follow-up Engine detecta `days_overdue >= 1` en la carga del dashboard.
2. Work Item sube de bucket de prioridad según Priority Engine.
3. Aparece en TODAY o WAITING FOR con acción sugerida `FOLLOW UP`.
4. Usuario hace click en `FOLLOW UP` → (V1: abre borrador/deep-link al thread original o WhatsApp; no se auto-envía nada) o `EXTEND` → reprograma fecha.

**Delegación**
1. Usuario asigna `responsible_id` a otra persona con `expected_date`.
2. `status → DELEGATED`.
3. Cuando `expected_date` vence sin `DONE`, reaparece en OPEN, evaluado por Risk Engine como cualquier waiting.

**Cierre**
1. Usuario marca `DONE` desde cualquier sección.
2. `status → DONE`, `last_activity_at` actualizado.
3. Si tenía `review_item` pendientes vinculados, quedan huérfanos visibles en REVIEW por si aportan info residual (no se auto-descartan).
4. Reversible con `REOPEN`.

---

## 20. Qué entra y qué NO entra en V1

**Entra:**
Gmail (lectura, polling), Calendar (lectura), captura manual, captura WhatsApp (alias email + Shortcut/endpoint), Work Item + Context + Source model, Normalization Engine con Rule Filter + LLM, Confidence system (HIGH/MEDIUM/LOW), Follow-up + Risk como funciones derivadas, Priority Engine de 4 factores con explicabilidad por plantilla, Dashboard único, bandeja Review unificada, acciones básicas (Done/Postpone/Delegate/Ignore/Received/Follow up/Edit/Note/Open Source), correction log sin ML.

**No entra (confirmado del brief original, sin cambios):**
AI Assistant tipo chat, entity resolution avanzada, context clustering automático, Meeting Briefs, integración Odoo, sync automático completo de WhatsApp/Zapia, scraping de WhatsApp, command palette, scheduling automático de horas, workflow builder, analytics/dashboards gráficos, gamification, app móvil nativa, microservicios, ML personalizado, notificaciones push.

**Sacado adicionalmente en esta revisión (sección 2):**
Risk Engine como módulo separado (pasa a función derivada), AI Suggestions y Potential Commitments como bandejas separadas (se fusionan), Estimated Time inferido por IA (pasa a manual con presets), Contact Tier con lógica de asignación (pasa a campo manual), subcategorías de Category (se mantiene solo el nivel superior), Blocking como relación entre Work Items (pasa a boolean simple), Morning Brief como artefacto generado aparte (es el mismo Dashboard).

---

## 21. Recomendación de stack final

Se mantiene la propuesta original, sin cambios estructurales:

- **Frontend/backend**: Next.js + TypeScript (API routes cubren Ingestion Layer + Normalization).
- **Base de datos**: Supabase/PostgreSQL (JSONB nativo para `raw_metadata`, suficiente para V1).
- **Hosting**: Vercel — **Vercel Cron** para los tres jobs periódicos (poll Gmail cada 5 min, refresh Calendar diario, recompute Risk/Priority en cada carga del dashboard, no como job separado). No hace falta una cola de mensajes (BullMQ/Inngest) para el volumen de un solo usuario — se agrega si en uso real el polling se vuelve insuficiente.
- **Auth**: Auth.js (NextAuth) con Google provider, restringido al dominio del workspace — no se necesita un sistema de auth propio para un usuario/equipo chico.
- **Google APIs**: Gmail API (`gmail.readonly` [+ `gmail.labels` opcional]), Calendar API (`calendar.readonly`).
- **Validación de salida del LLM**: Zod contra el JSON Schema del Normalizer — rechaza y reintenta si la estructura no calza, nunca se persiste una clasificación sin validar.
- **Captura móvil**: iOS Shortcut → endpoint HTTPS propio con token bearer.

---

## 22. Recomendación de modelo/proveedor de IA

Se diseña una **AI Provider Interface** única:

```
interface AIProvider {
  normalize(thread: NormalizedThread): Promise<ClassificationResult[]>
}
```

Toda la lógica aguas abajo (Work Item Engine, Follow-up, Risk, Priority) es agnóstica al proveedor — solo consume `ClassificationResult[]`. Cambiar de proveedor implica reimplementar un adapter, no tocar el resto del sistema.

**Para V1 concretamente**: dado el volumen esperado (un solo usuario, probablemente 20-60 threads/día entre Gmail y WhatsApp), el costo de tokens es marginal con cualquier proveedor serio — no es el criterio decisivo. Lo que sí importa en este caso puntual:
- **Salida estructurada confiable** (function calling / JSON mode estricto) — tanto Claude como GPT-4.1/4o-class lo soportan bien.
- **Español** — ambos son sólidos, sin diferencia relevante reportada en tareas de extracción como esta.
- **Threads largos** — ambos manejan bien el contexto necesario para un thread de email típico (no son documentos de cientos de páginas).

Con esos tres criterios empatados, la recomendación práctica es: **arrancar con el proveedor cuya cuenta/facturación ya tengas activa** (reduce fricción de setup en día 1), detrás de la interfaz. Después de 2-3 semanas de uso real, revisar tasa de error de clasificación y costo real, y decidir con datos si vale la pena cambiar — la interfaz existe exactamente para que ese cambio sea trivial.

---

## 23. Plan de implementación por etapas

| Etapa | Contenido | Objetivo de la etapa |
|---|---|---|
| **0. Base** | Auth, schema de DB, shell de Dashboard vacío | Infraestructura mínima corriendo |
| **1. Manual first** | CRUD de Work Item, captura manual con Normalizer, Dashboard con TODAY/WAITING/AT RISK reales pero sin fuentes automáticas | Validar el modelo de datos y la UI usando solo carga manual por unos días, antes de meter Gmail |
| **2. Gmail** | Ingestion + Rule Filter + AI Normalizer sobre Gmail (solo lectura, polling), auto-creación HIGH, bandeja Review | Primera fuente automática funcionando end-to-end |
| **3. Engines** | Follow-up, Risk, Priority Engine con explicabilidad, buckets DO NOW/TODAY/THIS WEEK/CAN WAIT | El dashboard empieza a priorizar solo, no solo a listar |
| **4. Calendar** | Eventos del día, tiempo disponible, match superficial con Context | Cierra el "cuánto tiempo tengo hoy" |
| **5. WhatsApp** | Alias de captura por email (día 1 de la etapa) + endpoint HTTPS/Shortcut (fast-follow, misma etapa) | Cumple el objetivo de captura en 2-5s |
| **6. Pulido de acciones** | Done/Postpone/Delegate/Received/Follow up/Extend, correction log | Completa el set de acciones del punto 26 |
| **7. Dogfooding** | 2 semanas de uso real diario, ajuste de umbrales (SLA de follow-up, thresholds de confidence) y del prompt del Normalizer según falsos positivos/negativos reales | Validar criterio de éxito (sección 24) con datos reales, no supuestos |

Cada etapa entrega algo usable — nunca hay una etapa que solo prepara la siguiente sin producir valor propio.

---

## 24. Criterios de aceptación V1

- Dashboard carga y es legible en <10 segundos de lectura (validado con el propio usuario, no un test automatizado).
- TODAY nunca muestra más de 5 Work Items, incluso con más de 5 candidatos de score alto.
- AT RISK muestra estado vacío explícito cuando no hay riesgos reales — nunca contenido inventado.
- Cada Work Item con fuente Gmail tiene un link funcional "Open Original Email".
- Un email enviado (OUTBOUND) que contiene una pregunta genera correctamente un WAITING; uno que contiene una promesa genera correctamente un COMMITMENT con next_action derivado.
- Estar en Cc no descarta automáticamente una comunicación (verificar con un caso real).
- Captura de WhatsApp vía Shortcut, de principio a fin (compartir → Work Item visible en Review o Today), toma menos de 10 segundos incluyendo desbloqueo del teléfono.
- Un WAITING sin actividad nueva no se cierra solo — requiere confirmación `RECEIVED` del usuario.
- El log de correcciones (`correction_log`) registra cambios manuales sobre campos generados por IA, consultable.
- Después de 2 semanas de uso diario real: tasa de falsos positivos en clasificación HIGH subjetivamente aceptable para el usuario (criterio cualitativo, no numérico — se define con el propio Felipe durante el dogfooding).
- Mantenimiento diario percibido por el usuario: menos de 5 minutos.
- El usuario reporta, sin que se le pregunte de forma sugestiva, que abre Work OS todas las mañanas porque confía en lo que muestra (criterio final del brief original, sección 33).

---

**STOP.** No se escribe código hasta la siguiente instrucción explícita.
