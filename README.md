# Work OS — V1 (Etapa 0 + Etapa 1 + Etapa 2)

Capa de atencion y seguimiento sobre trabajo real. Este README documenta exactamente
lo que se construyo, como configurarlo y como probarlo. La especificacion de producto
completa vive en [`WorkOS-MVP-Spec.md`](./WorkOS-MVP-Spec.md) — este README es la capa
de implementacion.

**Alcance de Etapa 2**: Gmail (solo lectura) + bandeja Review. Explicitamente NO
incluye Calendar, WhatsApp, Zapia, Odoo, Meeting Briefs, AI Assistant, analytics ni
notificaciones — eso queda para etapas futuras.

## Estado: verificado

`npx tsc --noEmit`, `npm run build` y `npm run test` (50 tests) pasan limpios en esta
maquina. El AI Normalizer (tanto captura manual como threads de Gmail) se valido contra
la API real de Anthropic. Lo unico que **no** se pudo probar en este entorno es el flujo
de OAuth de Gmail contra un proyecto de Google Cloud real y una casilla real — no hay
credenciales de Google Cloud disponibles aca. Los pasos exactos para probarlo estan en
la seccion 7.

## 1. Que se construyo

### Etapa 0 — Base
- Proyecto Next.js 14 (App Router) + TypeScript, sin `create-next-app`.
- Tailwind CSS con paleta propia (`ink`, `accent`, `risk`, `waiting`).
- Schema de Supabase/Postgres (`supabase/schema.sql`): `company`, `contact`, `context`,
  `work_item`, `note`, `correction_log`, `source_link`, con RLS y enums.
- Autenticacion con Google via Supabase Auth, restringida por `ALLOWED_EMAIL_DOMAIN`.
- Layout general + Dashboard shell. Seed de datos de demo.

### Etapa 1 — Manual First
- CRUD de Work Items, Companies, Contacts, Contexts.
- Captura manual en lenguaje natural con preview editable.
- AI Normalizer (`src/lib/ai`) detras de la interfaz `AIProvider` — Anthropic
  (`claude-sonnet-5`).
- Resolucion de fechas en espanol 100% determinista (`resolveDatePhrase`, con tests).
- Dashboard: TODAY (max. 5), AT RISK (funcion derivada), WAITING FOR, con acciones
  DONE / POSTPONE / DELEGATE / RECEIVED / EXTEND / REOPEN / IGNORE / EDIT / nota.
- Priority Engine y Risk Engine deterministicos, con tests. `correction_log` para
  auditar ediciones sobre valores sugeridos por IA. Busqueda simple. Responsive.

### Etapa 2 — Gmail + Review
- **OAuth de Gmail, solo lectura** (`gmail.readonly`), como paso adicional despues del
  login normal ("Conectar Gmail" en Settings) — nunca se piden permisos de escritura.
- **Tokens propios para refresh en background**: Supabase solo expone el
  access_token/refresh_token de Google una vez, en el momento del login — se capturan
  en `google_connection` y se refrescan despues con el mismo `GOOGLE_CLIENT_ID`/
  `GOOGLE_CLIENT_SECRET` que se configuro en Supabase (ver seccion 3 de decisiones).
- **Bootstrap acotado**: primera sincronizacion elegida por el usuario (7/14/30 dias,
  default 14) — nunca procesa la casilla entera silenciosamente. Deja un cursor
  (`history_id` de Gmail) listo para sync incremental.
- **Sync incremental por polling**, disparable por cron externo (`CRON_SECRET`) o
  manualmente ("Sync now" en Settings) — nunca vuelve a descargar todo.
- **Pipeline por thread**: Rule Filter (deterministico, barato) → AI Normalizer de
  Gmail (thread completo, INBOUND/OUTBOUND) → matching contra Work Item existente →
  Decision Engine (crear / actualizar seguro / mandar a Review / ignorar) → DB.
- **Bandeja Review unificada** (`review_item`): sugerencias nuevas, actualizaciones,
  posibles compromisos propios de baja confianza, posibles duplicados, y "¿esto
  resuelve lo que esperabas?" — todo en una sola lista, nunca separada.
- **Priority Engine**: nuevo factor `someone_waiting` (+30) cuando hay `next_action`
  pendiente y el ultimo mensaje del thread fue INBOUND.
- **Regla de delegacion** corregida tanto en captura manual (fix puntual al hallazgo
  de la validacion — caso 8 de la baseline) como en el normalizer de Gmail desde el
  arranque: una accion delegada explicitamente a otra persona nunca se carga como
  `next_action` propia.

## 2. Estructura del proyecto

```
supabase/
  schema.sql                Schema Etapa 0/1 (correr primero)
  schema_gmail.sql           Migracion aditiva Etapa 2 (correr despues)

scripts/
  seed.ts / seed-cleanup.ts
  eval-normalizer.ts          10 + 10 casos de captura manual contra la IA real
  eval-gmail-normalizer.ts    5 casos de threads (direccion + delegacion) contra la IA real
  check-setup.ts              Valida variables de entorno sin imprimir secretos

src/
  middleware.ts              Gate de auth (con excepcion self-auth para /api/gmail/sync)

  lib/
    supabase/                 server.ts, browser.ts, service.ts (service role), types.ts
    google/                   oauthClient.ts (refresh), connection.ts (CRUD), constants.ts
    gmail/                    client.ts (API), threadParser.ts, ruleFilter.ts,
                               contextWindow.ts, workItemMatch.ts, decisionEngine.ts,
                               applySync.ts, sync.ts (bootstrap + incremental)
    dates/, format/, engine/  (priority.ts ahora con someone_waiting)
    ai/                       AIProvider + captura manual + emailSchema/emailPrompt (Gmail)
    workItems/                queries, entities, reviewItems.ts (Etapa 2), correctionLog

  components/                 UI (incluye ReviewCard, GmailConnectPanel — Etapa 2)
  app/
    login/, auth/callback/, auth/gmail-callback/ (Etapa 2), auth/signout/
    dashboard/, settings/, search/
    api/
      gmail/                   status, bootstrap, sync (Etapa 2)
      review/                  list + accept/apply/received/keep-waiting/ignore (Etapa 2)
      work-items/, companies/, contacts/, contexts/, search/, capture/
```

## 3. Decisiones tecnicas

**Las fechas no las calcula la IA** (captura manual NI Gmail). Frase cruda → 
`resolveDatePhrase` (determinista, testeado). Ver `src/lib/dates/resolveDatePhrase.test.ts`.

**Tokens de Gmail: por que hace falta `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` propios.**
Supabase Auth usa sus propias credenciales para el login (configuradas en su Dashboard)
y solo devuelve el `provider_token`/`provider_refresh_token` de Google en la respuesta
inmediata del login — nunca mas. El sync de Gmail corre en background (cron, sin sesion
de usuario), asi que necesita poder refrescar el access_token por su cuenta. Como quien
configura el provider de Google en Supabase es el mismo desarrollador de esta app, esas
credenciales (Client ID/Secret de Google Cloud) estan disponibles y se reusan
directamente — ver `src/lib/google/oauthClient.ts`.

**Nunca se cierra un WAITING solo**, ni con confidence HIGH. Si un Work Item con
`waiting_for_what` recibe actividad INBOUND nueva, la unica salida posible del Decision
Engine es `RECEIVED_CHECK` (bandeja Review, botones Received/Keep Waiting) — esa regla
tiene prioridad sobre cualquier otra, incluso sobre `classification=IGNORE`. Ver
`src/lib/gmail/decisionEngine.ts` y sus tests.

**HIGH confidence + Work Item existente: solo se actualizan campos vacios.** Si la
nueva interpretacion pisaria un valor ya cargado (`next_action`, `waiting_for_what`,
fechas) con uno distinto, se manda a Review en vez de aplicarse sola — nunca se
sobreescribe en silencio algo que el sistema (o el usuario) ya habia establecido.

**Deduplicacion sin embeddings.** Coincidencia por mismo thread (regla fuerte, siempre
gana) o, si no hay match directo, por superposicion de palabras del titulo (≥50%) +
mismo contacto/empresa/context (regla heuristica, manda a Review como "posible
duplicado"). Ver `src/lib/gmail/workItemMatch.ts`.

**El normalizer de Gmail es un prompt/schema separado del de captura manual** (mismos
principios, mismos nombres de campo donde tiene sentido) — mezclar "una frase suelta"
con "thread completo con direccion INBOUND/OUTBOUND" en un solo prompt lo hacia confuso
para ambos casos. Comparten el mismo `AIProvider`/`AnthropicProvider` por debajo.

**`/api/gmail/sync` tiene autenticacion dual** a proposito: la puede llamar un cron
externo (header `Authorization: Bearer <CRON_SECRET>`, sin cookies de sesion) o el
boton "Sync now" de un usuario logueado. `middleware.ts` exime esta ruta puntual del
gate de sesion generico; el chequeo pasa a vivir adentro de la propia ruta.

**Las Company/Contact/Context nuevas solo se crean solas en el camino 100% automatico**
(HIGH confidence, sin Work Item existente). En cualquier sugerencia que pasa por Review,
la creacion de entidades se demora hasta que el usuario ACEPTA — nunca antes.

**Postpone se reactiva al leer, sin cron** (igual que Etapa 1). El sync de Gmail en si
SI necesita un disparador externo (cron o boton manual) porque no hay proceso
persistente en un deploy serverless — ver seccion 7.

## 4. Proveedor de IA

**Anthropic, `claude-sonnet-5`** (configurable via `ANTHROPIC_MODEL`), con dos metodos
en la interfaz `AIProvider`: `normalizeManualCapture` y `normalizeEmailThread`. Mismo
razonamiento que en Etapa 1 (ver `src/lib/ai/anthropicProvider.ts` para el detalle de
implementacion — comparten la logica de "llamar tool + reintentar con Zod" via un
helper privado).

## 5. Configuracion

### Requisitos
- Node.js 20.6+
- Una cuenta de Supabase
- Un proyecto de Google Cloud (el mismo que ya usan para el login de Supabase)
- Una API key de Anthropic

### Pasos

1. **Supabase**: en el SQL Editor, correr primero [`supabase/schema.sql`](./supabase/schema.sql)
   y despues [`supabase/schema_gmail.sql`](./supabase/schema_gmail.sql) (en ese orden).

2. **Google Cloud — login (Etapa 0/1)**: seguir la guia de Supabase para configurar el
   provider de Google (Dashboard > Authentication > Providers > Google), pegando el
   Client ID/Secret de un OAuth Client de Google Cloud Console.

3. **Google Cloud — Gmail (Etapa 2)**, en el MISMO proyecto de Google Cloud:
   - Habilitar la **Gmail API** (APIs & Services > Library > Gmail API > Enable).
   - En **OAuth consent screen**: agregar el scope `.../auth/gmail.readonly` a la lista
     de scopes solicitados, y si el tipo de usuario es "External", agregar a los
     testers/usuarios permitidos. Si toda la organizacion usa Google Workspace,
     configurar el consent screen como **Internal** — evita el proceso de verificacion
     de Google que exige para scopes sensibles como Gmail en apps externas.
   - Copiar el mismo Client ID/Secret que usaste en Supabase a `GOOGLE_CLIENT_ID`/
     `GOOGLE_CLIENT_SECRET` en `.env.local` (ver seccion 3 de por que hace falta esto).

4. **Variables de entorno**: copiar `.env.example` a `.env.local` y completar. Ademas de
   las de Etapa 0/1, para Etapa 2:
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: del paso anterior.
   - `USER_EMAIL_ADDRESSES`: tu(s) direccion(es) de email, separadas por coma — se usa
     para distinguir INBOUND/OUTBOUND.
   - `CRON_SECRET`: string random largo (ej. `openssl rand -hex 32`), para autorizar el
     sync automatico sin sesion de usuario.
   - `GMAIL_POLL_INTERVAL_MINUTES` (default 10) y `GMAIL_BOOTSTRAP_DEFAULT_DAYS`
     (default 14): informativos/de referencia para quien configure el cron — el codigo
     no lee el primero directamente, lo usa quien programe la llamada periodica.

5. **Instalar y correr**:
   ```bash
   npm install
   npm run check:setup
   npm run dev
   ```

6. **(Opcional) Datos de demo**: `npm run seed` / `npm run seed:cleanup`.

## 6. Verificacion tecnica

```bash
npm install
npx tsc --noEmit     # PASS
npm run build        # PASS
npm run test         # 50/50 (incluye Etapa 2)
```

## 7. Como probar Gmail

1. Iniciar sesion normalmente (login de siempre, sin scopes de Gmail todavia).
2. Ir a **Settings** → seccion **Gmail** → **Conectar Gmail**. Esto dispara un segundo
   paso de consentimiento de Google (con `access_type=offline&prompt=consent`, para
   garantizar que llegue un `refresh_token`) y vuelve a `/auth/gmail-callback`, que
   guarda la conexion.
3. Elegir el rango de bootstrap (7/14/30 dias) y tocar **Iniciar sincronizacion**. Esto
   llama a `POST /api/gmail/bootstrap`, que procesa esa ventana y muestra el resumen
   (THREADS ANALYZED / HIGH ITEMS / REVIEW ITEMS / IGNORED).
4. Revisar la bandeja **REVIEW** en el Dashboard — ahi aparecen las sugerencias que no
   se auto-aplicaron (confidence MEDIUM/LOW, actualizaciones que pisarian algo, posibles
   duplicados, "¿recibiste lo que esperabas?").
5. Para sincronizar de nuevo manualmente: boton **Sync now** en Settings (llama a
   `POST /api/gmail/sync` con la sesion del usuario).
6. Para automatizar el polling cada `GMAIL_POLL_INTERVAL_MINUTES` (default 10), apuntar
   un cron externo a:
   ```bash
   curl -X POST https://tu-dominio/api/gmail/sync \
     -H "Authorization: Bearer $CRON_SECRET"
   ```
   (Vercel Cron, un GitHub Action programado, o cualquier scheduler que pueda hacer un
   POST HTTP sirve — el pipeline no depende de cual).

**Smoke test del normalizer de Gmail sin necesitar Gmail real:**
```bash
npm run eval:gmail-normalizer
```
Corre 5 threads sinteticos (los 4 ejemplos canonicos de direccion del spec + el caso de
delegacion) contra la IA real, mismo formato que `eval:normalizer` (INPUT/EXPECTED/
OUTPUT/RESULT + resumen). No toca Supabase ni Gmail.

## 8. Tests agregados en Etapa 2

- `src/lib/gmail/ruleFilter.test.ts` — bulk/newsletter, Cc nunca descarta, noreply nunca
  descarta solo.
- `src/lib/gmail/threadParser.test.ts` — deteccion INBOUND/OUTBOUND contra
  `USER_EMAIL_ADDRESSES` (case-insensitive, alias multiples).
- `src/lib/gmail/decisionEngine.test.ts` — los 13 casos de ruteo: IGNORE siempre gana,
  HIGH crea, HIGH+duplicado → review, MEDIUM siempre a review, LOW ignora salvo
  OUTBOUND ACTION/COMMITMENT (potential commitment), HIGH+existing solo llena vacios,
  nunca pisa un valor ya cargado, y el mas importante: WAITING + inbound nueva siempre
  gana con `RECEIVED_CHECK` sin importar confidence/classification.
- `src/lib/gmail/workItemMatch.test.ts` — similaridad de titulos para deduplicacion.
- `src/lib/engine/priority.test.ts` — casos nuevos para `someone_waiting`.

Todos deterministicos, sin llamadas a IA ni DB — corren con `npm run test`.

## 9. Limitaciones conocidas

Heredadas de Etapa 0/1 (sin cambios): resolver de fechas no es NLP completo, "el
miercoles que viene" = "el miercoles", dedupe de entidades es substring simple, sin
tests E2E de UI, `correction_log` sin visualizador propio, Next.js 14.2.35 con una
vulnerabilidad HIGH residual sin fix en la rama 14.x (ver detalle en el historial —
no aplica a features que usa esta app).

Nuevas de Etapa 2:
- **No se pudo probar el flujo real de OAuth/Gmail en este entorno** — no hay proyecto
  de Google Cloud ni casilla real disponibles aca. El normalizer SI se valido contra la
  API real (`npm run eval:gmail-normalizer`, 5/5). El resto del pipeline (rule filter,
  matching, decision engine) esta cubierto por tests deterministicos, pero la
  integracion end-to-end contra Gmail real queda pendiente de que se configuren
  credenciales reales.
- **Solo polling, no push.** El pipeline esta armado para que cambiar a
  webhook/Pub-Sub despues no toque `processThread`/`applySync` (quien dispare el sync
  no le importa a esa capa), pero implementar el webhook en si queda para mas adelante.
- **Tokens en texto plano en `google_connection`**, protegidos solo por RLS (igual que
  el resto del schema) — cifrado a nivel de columna (pgsodium/Vault) es una mejora
  razonable si esto pasa a operarse mas alla de uso interno.
- **"Possible Duplicate" no tiene selector de candidato en la UI todavia** — muestra
  cuantos candidatos hay y permite crear igual o ignorar; el backend ya soporta
  `targetWorkItemId` para linkear a uno especifico (`POST /api/review/:id/apply`), falta
  el picker en `ReviewCard`.
- **Un thread = un asunto** (V1 no separa multiples asuntos independientes dentro del
  mismo thread — simplificacion deliberada, documentada tambien en el spec original).
  Company/Contact/Context no son editables desde la card de Review (si desde el
  Work Item ya creado, via el detail sheet existente).
- En el smoke test real observe que el modelo a veces llena `waiting_for_person` con un
  placeholder tipo "Destinatario no identificado" en vez de `null` cuando no hay nombre
  — no rompe nada (el campo es de todas formas informativo), pero es candidato a un
  ajuste de prompt puntual en la proxima iteracion en vez de tocarlo ahora sin mas
  evidencia.
- El history_id de Gmail puede vencer si pasa mucho tiempo sin sincronizar; el codigo
  cae a un fallback de 2 dias automaticamente (`HistoryExpiredError` en
  `src/lib/gmail/client.ts`), pero esto no se pudo probar contra la API real.

## 10. Riesgos detectados

- Si `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` no coinciden exactamente con los
  configurados en Supabase, el refresh en background va a fallar con un error de OAuth
  — validar esto es parte de la prueba real pendiente.
- Sin verificacion de Google (consent screen "External" + sensitive scope), el login de
  Gmail puede mostrar una pantalla de advertencia o bloquearse para usuarios fuera de la
  lista de testers — usar "Internal" si todos son de la misma Workspace evita esto por
  completo.
- El costo de tokens de IA crece con el volumen real de threads — el Rule Filter baja el
  volumen que llega al LLM, pero no se midio con datos reales todavia.

## 11. Que sigue (fuera de alcance, confirmado explicitamente)

Calendar real, Odoo, Drive, Slack, AI Chat, Meeting Briefs, envio de email, permisos de
escritura en Gmail, WhatsApp Web scraping o hacks de WhatsApp Business, analytics
avanzado, embeddings/clustering semantico, app movil nativa, notificaciones push,
pipeline tipo CRM, colaboracion multi-usuario, automation builder. Nada de esto se toco
en esta iteracion.

## 13. Zapia (WhatsApp automatico)

Zapia hace de SOURCE/INGESTION: relevanta WhatsApp segun su propio schedule (11:00,
15:00, 18:00 hora Argentina) y manda cada conversacion a `POST /api/capture/zapia`. Work
OS nunca decide del lado de Zapia — Zapia solo entrega texto, todo el analisis
(ACTION/WAITING/COMMITMENT/INFO/IGNORE, matching con Work Items existentes, prioridad,
riesgo) lo hace el mismo AIProvider + engines que ya usan Gmail y la captura manual.

**Requiere la migracion `supabase/schema_zapia.sql`** (tabla `whatsapp_ingestion`, usada
para idempotencia y tracking de errores/retry) — correrla en el SQL Editor de Supabase
DESPUES de `schema_v1.sql`.

**Auth:** header `Authorization: Bearer <ZAPIA_WEBHOOK_SECRET>`. Configurar ese secret en
`.env.local` y pasarselo a Zapia como credencial protegida.

**Review first:** en V1, TODO resultado relevante (incluso HIGH confidence) va a la
bandeja Review — nunca se crea ni actualiza un Work Item automaticamente desde WhatsApp.
Esto es deliberado: primero se mide calidad sobre conversaciones reales.

**Idempotencia:** si Zapia reintenta el mismo POST, Work OS lo detecta (por message_id o,
si no vienen, por un hash del contenido) y responde 200 sin duplicar nada en Review.

**Contrato exacto del payload:** ver el JSON al final de este README (o pedirselo a
Claude Code, que lo tiene documentado ahi mismo).

## 12. WhatsApp Quick Capture (V1)

No existe una API oficial de Zapia verificada para ingestion automatica de WhatsApp —
Work OS **no** inventa esa integracion. Lo que hay en V1 es una via de captura rapida y
manual: `POST /api/capture/whatsapp`, pensada para dispararse desde un Apple Shortcut en
2-5 segundos sin abrir la app.

**Como funciona el endpoint:**
- Autentica con un bearer token estatico (`WHATSAPP_CAPTURE_TOKEN`, no con sesion de
  usuario — el Shortcut no puede hacer login interactivo).
- Recibe `{ "text": "...", "contact"?: "...", "context"?: "..." }`.
- El texto pasa por el mismo AI Normalizer que la captura manual (`normalizeManualCapture`).
- El resultado **nunca crea un Work Item directo**: siempre entra a la bandeja **Review**
  (`source = WHATSAPP`) para que confirmes Company/Contact/Context y el resto antes de
  que quede como Work Item real — igual que las sugerencias de Gmail.

**Setup del Apple Shortcut (opcion A — Share Sheet, recomendada):**
1. App **Atajos** (Shortcuts) → crear un atajo nuevo, nombrarlo p. ej. "Work OS Capture".
2. Icono de info (ⓘ) → activar **"Mostrar en la hoja de recursos compartidos"** (Show in
   Share Sheet) → en "Tipos de recursos compartidos" dejar solo **Texto**.
3. Agregar la accion **"Obtener contenido de URL"** (Get Contents of URL):
   - URL: `https://<tu-dominio>/api/capture/whatsapp`
   - Metodo: `POST`
   - Encabezados: `Authorization` = `Bearer <WHATSAPP_CAPTURE_TOKEN>`, `Content-Type` = `application/json`
   - Cuerpo (JSON): `{ "text": [Entrada del Atajo / Shortcut Input] }`
4. (Opcional) Agregar **"Mostrar notificacion"** al final con el texto "Enviado a Work OS".
5. Guardar.
6. Uso: en WhatsApp, mantener presionado el mensaje relevante → **Reenviar/Compartir** →
   elegir "Work OS Capture" en la hoja de recursos compartidos (puede estar bajo "Mas").

**Alternativa minima si WhatsApp no ofrece compartir ese mensaje puntual a la hoja de
recursos compartidos** (varia segun version de iOS/WhatsApp): mantener presionado el
mensaje → **Copiar** → abrir el Shortcut manualmente (icono en pantalla de inicio, widget,
o "Oye Siri, Work OS Capture") con la primera accion siendo **"Obtener el portapapeles"**
en vez de "Entrada del Atajo", y el resto igual. Son dos toques en vez de uno, pero no
depende de que WhatsApp exponga el share sheet para ese mensaje.

**Estado en Settings:** la seccion Integrations muestra "Quick Capture enabled" solo si
`WHATSAPP_CAPTURE_TOKEN` esta configurado en el servidor — nunca se muestra como
"conectado" sin que el token exista de verdad.
