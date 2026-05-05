// Centralised, validated env access. Fail fast on missing critical secrets.

import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // True when running under vitest. Test setup file sets this so route
  // factories can disable side effects (e.g. session-cleaner timers).
  VITEST: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  DATA_DIR: z.string().default('./data'),

  APP_PASSWORD: z.string().min(1, 'APP_PASSWORD is required'),
  COOKIE_SECRET: z.string().min(32, 'COOKIE_SECRET must be at least 32 chars'),
  // Set true when serving over HTTPS. Default false for direct-HTTP LAN access.
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true' || v === '1'),

  TMDB_API_KEY: z.string().min(1, 'TMDB_API_KEY is required').optional(),

  PROWLARR_URL: z.string().url().default('http://prowlarr:9696'),
  PROWLARR_API_KEY: z.string().optional(),

  SUBTITLE_PRIMARY: z.enum(['opensubtitles', 'subdl']).default('opensubtitles'),
  OPENSUBS_API_KEY: z.string().optional(),
  OPENSUBS_USERNAME: z.string().optional(),
  OPENSUBS_PASSWORD: z.string().optional(),
  SUBDL_API_KEY: z.string().optional(),

  MAX_CONCURRENT_TRANSCODES: z.coerce.number().int().positive().default(1),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Environment validation failed:');
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
