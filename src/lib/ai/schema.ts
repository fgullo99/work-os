import { z } from "zod";

/**
 * Forma exacta que debe devolver cualquier AIProvider para captura manual.
 * Fuente de verdad unica: tanto la validacion (Zod) como el JSON Schema que se le
 * pasa al modelo (ver anthropicProvider.ts) derivan de esta definicion.
 *
 * Las fechas se devuelven como FRASES en espanol tal cual las dijo el usuario
 * ("miercoles", "antes del viernes"), nunca como fechas ya calculadas — el calculo
 * lo hace src/lib/dates/resolveDatePhrase.ts de forma deterministica.
 */
export const manualCaptureResultSchema = z.object({
  title: z.string().min(1).max(140).describe("Titulo corto y claro del Work Item (maximo ~8 palabras)."),

  next_action: z
    .string()
    .min(1)
    .max(200)
    .nullable()
    .describe("Que tiene que hacer el usuario. Null si no hay accion propia pendiente."),

  waiting_for_person: z
    .string()
    .min(1)
    .max(100)
    .nullable()
    .describe("Nombre de la persona de quien se espera algo. Null si no aplica o no se menciona."),

  waiting_for_what: z
    .string()
    .min(1)
    .max(200)
    .nullable()
    .describe("Que se esta esperando de un tercero. Null si no hay espera."),

  due_date_phrase: z
    .string()
    .min(1)
    .max(60)
    .nullable()
    .describe("Frase de fecha limite para next_action, tal cual aparece en el texto (ej: 'manana', 'el viernes'). Null si no hay."),

  expected_date_phrase: z
    .string()
    .min(1)
    .max(60)
    .nullable()
    .describe("Frase de fecha en que se espera recibir lo esperado de terceros. Null si no hay."),

  committed_date_phrase: z
    .string()
    .min(1)
    .max(60)
    .nullable()
    .describe("Frase de fecha de un compromiso concreto asumido por el usuario. Null si no hay."),

  suggested_company: z.string().min(1).max(100).nullable().describe("Empresa mencionada, si hay alguna evidente."),
  suggested_contact: z.string().min(1).max(100).nullable().describe("Persona de contacto principal mencionada."),
  suggested_context: z
    .string()
    .min(1)
    .max(140)
    .nullable()
    .describe("Asunto/proyecto al que pertenece esto, si es identificable (ej: 'Cliente ABC - Trafo 1600 kVA')."),
  suggested_category: z
    .enum(["COMERCIAL", "TECNICO", "OPERACIONES", "ADMINISTRATIVO"])
    .nullable()
    .describe("Categoria de negocio. Null si no es evidente."),

  blocking: z.boolean().describe("true si este asunto bloquea explicitamente otra actividad (ej: produccion)."),

  confidence: z
    .enum(["HIGH", "MEDIUM", "LOW"])
    .describe("Que tan seguro estas de esta interpretacion en su conjunto."),

  summary: z.string().min(1).max(200).describe("Resumen de una linea de que representa este Work Item."),
});

export type ManualCaptureResult = z.infer<typeof manualCaptureResultSchema>;
