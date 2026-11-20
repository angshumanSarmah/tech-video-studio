import { z } from 'zod';

/** Agent roles that each get their own model. Exhaustive. */
export const MODEL_ROLES = [
  'researcher',
  'director',
  'scriptwriter',
  'generator',
  'curator',
  'analyst',
  'asset',
] as const;

export const ModelRoleSchema = z.enum(MODEL_ROLES);
export type ModelRole = z.infer<typeof ModelRoleSchema>;

/** OpenAI-compatible endpoint. Source: https://api-docs.deepseek.com (checked 2026-11-18). */
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

/**
 * API model ids from DeepSeek's pricing page (checked 2026-11-18).
 * `deepseek-flash` is the documented name for DeepSeek-V4.1-Flash-1017.
 */
export const DEEPSEEK_MODELS = {
  v4Pro: 'deepseek-v4-pro',
  v41Flash: 'deepseek-flash',
} as const;

const ModelIdSchema = z.string().trim().min(1);

const flash = (): z.ZodDefault<typeof ModelIdSchema> =>
  ModelIdSchema.default(DEEPSEEK_MODELS.v41Flash);

export const ModelMapSchema = z.strictObject({
  researcher: flash(),
  director: ModelIdSchema.default(DEEPSEEK_MODELS.v4Pro),
  scriptwriter: flash(),
  generator: flash(),
  curator: flash(),
  analyst: flash(),
  asset: flash(),
});

export type ModelMap = z.infer<typeof ModelMapSchema>;

/** `HH:MM` in UTC. `24:00` is allowed as an exclusive end of day. */
const UtcTimeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Expected a UTC time as "HH:MM" (00:00–24:00)');

/** Half-open window [start, end) within one UTC day. Split windows that cross midnight. */
export const UtcWindowSchema = z
  .strictObject({ start: UtcTimeSchema, end: UtcTimeSchema })
  .refine((w) => w.start < w.end, {
    message: 'Window start must be before end (split windows that cross midnight)',
    path: ['end'],
  });

export type UtcWindow = z.infer<typeof UtcWindowSchema>;

/** ISO weekday: 1 = Monday … 7 = Sunday. */
const IsoWeekdaySchema = z.number().int().min(1).max(7);

/**
 * Off-peak pricing. Modelled as peak windows because that is how DeepSeek defines it: peak is the
 * listed weekday windows, every other hour (weekends included) is off-peak.
 * Off-peak price = peak price × multiplier.
 */
export const OffPeakSchema = z.strictObject({
  multiplier: z.number().positive().max(1),
  peakDaysUtc: z.array(IsoWeekdaySchema).min(1),
  peakWindowsUtc: z.array(UtcWindowSchema).min(1),
});

export type OffPeak = z.infer<typeof OffPeakSchema>;

const UsdPerMTokSchema = z.number().nonnegative();

/** Peak prices in USD per million tokens. */
export const ModelPriceSchema = z.strictObject({
  inputCacheHitPerMTok: UsdPerMTokSchema,
  inputCacheMissPerMTok: UsdPerMTokSchema,
  outputPerMTok: UsdPerMTokSchema,
  offPeak: OffPeakSchema.optional(),
});

export type ModelPrice = z.infer<typeof ModelPriceSchema>;

export const PriceTableSchema = z.record(ModelIdSchema, ModelPriceSchema);
export type PriceTable = z.infer<typeof PriceTableSchema>;

/** DeepSeek off-peak rule (checked 2026-11-18). Chinese public holidays are not modelled. */
function deepseekOffPeak(): OffPeak {
  return {
    multiplier: 0.5,
    peakDaysUtc: [1, 2, 3, 4, 5],
    peakWindowsUtc: [
      { start: '01:00', end: '04:00' },
      { start: '06:00', end: '10:00' },
    ],
  };
}

/** Fresh copy each call so defaults are never shared between parsed configs. */
export function defaultPriceTable(): PriceTable {
  return {
    [DEEPSEEK_MODELS.v41Flash]: {
      inputCacheHitPerMTok: 0.006,
      inputCacheMissPerMTok: 0.3,
      outputPerMTok: 1.2,
      offPeak: deepseekOffPeak(),
    },
    [DEEPSEEK_MODELS.v4Pro]: {
      inputCacheHitPerMTok: 0.044,
      inputCacheMissPerMTok: 1.32,
      outputPerMTok: 3.96,
      offPeak: deepseekOffPeak(),
    },
  };
}

export const LlmSettingsSchema = z
  .strictObject({
    baseUrl: z.url().default(DEEPSEEK_BASE_URL),
    /** Optional so the Settings UI can set it; DEEPSEEK_API_KEY in .env takes precedence. */
    apiKey: z.string().trim().min(1).optional(),
    models: ModelMapSchema.prefault({}),
    /**
     * Per HTTP request. Generous because the Director's reasoning model can think for minutes
     * before a long JSON answer; 429/5xx retries each get their own timeout.
     */
    requestTimeoutSec: z.number().int().min(10).max(1800).default(300),
    prices: PriceTableSchema.default(defaultPriceTable),
  })
  .superRefine((llm, ctx) => {
    for (const role of MODEL_ROLES) {
      const model = llm.models[role];
      if (llm.prices[model]) continue;
      ctx.addIssue({
        code: 'custom',
        path: ['models', role],
        message: `Model "${model}" has no entry in llm.prices`,
      });
    }
  });

export type LlmSettings = z.infer<typeof LlmSettingsSchema>;
