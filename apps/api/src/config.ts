import { z } from 'zod';
import { execFileSync } from 'node:child_process';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  GITHUB_TOKEN: z.string().default(''),
  GITHUB_OWNER: z.string().default(''),
  GITHUB_CATALOG_REPO: z.string().default('csd-catalog'),
  GITHUB_REPO_MAP: z.string().default('{"default":"csd-materials"}'),
  ADMIN_PASSWORD: z.string().min(12).default('change-this-password'),
  JWT_SECRET: z.string().min(32).default('development-secret-must-have-32-chars'),
  ADMIN_TELEGRAM_IDS: z.string().default(''),
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  PUBLIC_SITE_URL: z.string().url().default('http://localhost:5173'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:3000'),
});

const parsed = envSchema.parse(process.env);
if (parsed.NODE_ENV === 'production' && parsed.ADMIN_PASSWORD === 'change-this-password') throw new Error('Set a secure ADMIN_PASSWORD in production');
if (parsed.NODE_ENV === 'production' && parsed.JWT_SECRET === 'development-secret-must-have-32-chars') throw new Error('Set a random JWT_SECRET in production');
let repoMap: Record<string, string>;
try { repoMap = z.record(z.string()).parse(JSON.parse(parsed.GITHUB_REPO_MAP)); }
catch { throw new Error('GITHUB_REPO_MAP must be a JSON object'); }

function githubCliToken() {
  if (parsed.NODE_ENV === 'production') return '';
  try { return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
}
const githubToken = parsed.GITHUB_TOKEN || process.env.GH_TOKEN || githubCliToken();

export const config = {
  ...parsed,
  GITHUB_TOKEN: githubToken,
  repoMap,
  adminTelegramIds: new Set(parsed.ADMIN_TELEGRAM_IDS.split(',').map(Number).filter(Number.isFinite)),
  githubReady: Boolean(githubToken && parsed.GITHUB_OWNER),
};
