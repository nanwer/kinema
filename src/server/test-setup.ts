// Stubs required env vars so modules that import './env.js' don't bail out at load.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.APP_PASSWORD ??= 'test-password';
process.env.COOKIE_SECRET ??= 'test-cookie-secret-min-32-chars-aaaaaaa';
// Fresh DATA_DIR per vitest worker so DB state can't leak across test runs
// or between forks. mkdtempSync is sync to ensure it's set before any
// downstream module reads it.
process.env.DATA_DIR ??= mkdtempSync(path.join(tmpdir(), 'stream-app-test-'));
process.env.NODE_ENV ??= 'test';
process.env.VITEST ??= '1';
