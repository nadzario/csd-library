import { z } from 'zod';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertCredentials } from './lib/credentials.js';
import { randomBytes } from 'node:crypto';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  TRUSTED_PROXIES: z.string().default(''),
  GITHUB_TOKEN: z.string().default(''),
  GITHUB_OWNER: z.string().default(''),
  GITHUB_CATALOG_REPO: z.string().default('csd-catalog'),
  GITHUB_CATALOG_BRANCH: z.string().min(1).default('main'),
  LOCAL_CATALOG_PATH: z.string().default(fileURLToPath(new URL('../../../data/catalog.json', import.meta.url))),
  GITHUB_REPO_MAP: z.string().default('{"default":"csd-materials"}'),
  ADMIN_PASSWORD: z.string().min(12).max(512).default(() => randomBytes(32).toString('base64url')),
  JWT_SECRET: z.string().min(32).default(() => randomBytes(48).toString('base64url')),
  ADMIN_TELEGRAM_IDS: z.string().default(''),
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  PUBLIC_SITE_URL: z.string().url().default('http://localhost:5173'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  PUBLIC_SUBMISSION_MAX_MB: z.coerce.number().int().positive().max(500).default(95),
  PUBLIC_QUEUE_MAX_MB: z.coerce.number().int().positive().default(5120),
  PUBLIC_QUEUE_MAX_FILES: z.coerce.number().int().positive().default(1000),
  PUBLIC_UPLOAD_CONCURRENCY: z.coerce.number().int().positive().max(32).default(4),
});

const parsed = envSchema.parse(process.env);
assertCredentials(parsed);
if (parsed.NODE_ENV === 'production' && (!process.env.ADMIN_PASSWORD || !process.env.JWT_SECRET)) {
  throw new Error('Set ADMIN_PASSWORD and JWT_SECRET explicitly in production');
}
let repoMap: Record<string, string>;
try { repoMap = z.record(z.string()).parse(JSON.parse(parsed.GITHUB_REPO_MAP)); }
catch { throw new Error('GITHUB_REPO_MAP must be a JSON object'); }

function githubCliToken() {
  try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
}
const githubToken = parsed.GITHUB_TOKEN || process.env.GH_TOKEN || githubCliToken();

export const config = {
  ...parsed,
  GITHUB_TOKEN: githubToken,
  repoMap,
  adminTelegramIds: new Set(parsed.ADMIN_TELEGRAM_IDS.split(',').map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)),
  githubReady: Boolean(githubToken && parsed.GITHUB_OWNER),
};
