import 'dotenv/config';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { materialKindSchema, type MaterialKind } from '@csd/shared';
import { GitHubPublisher } from '../apps/api/src/services/github-publisher.js';

type YandexItem = {
  path: string; type: 'dir' | 'file'; name: string; size?: number; mime_type?: string;
  sha256?: string; file?: string; modified: string;
  _embedded?: { total: number; items: YandexItem[] };
};

const publicKey = process.env.YANDEX_PUBLIC_URL || 'https://disk.yandex.ru/d/uBxTJDaahuSjZA';
const publish = process.argv.includes('--publish');
const useInventory = process.argv.includes('--use-inventory');
const inventoryPath = join(process.cwd(), 'data', 'yandex-inventory.json');
let yandexRateLimitedUntil = 0;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function fetchWithRetry(url: string | URL, init?: RequestInit, attempts = 6): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const cooldown = yandexRateLimitedUntil - Date.now();
    if (cooldown > 0) await wait(cooldown);
    try {
      const response = await fetch(url, init);
      if (response.ok || (response.status < 500 && response.status !== 429)) return response;
      const body = await response.text();
      lastError = new Error(`HTTP ${response.status}: ${body}`);
      if (response.status === 429) {
        const cooldownMs = Math.max(60_000, Number(process.env.YANDEX_429_COOLDOWN_MS) || 300_000);
        yandexRateLimitedUntil = Date.now() + cooldownMs;
        console.warn(`Yandex download limit reached; pausing migration for ${Math.round(cooldownMs / 60_000)} minutes…`);
      }
    } catch (error) { lastError = error; }
    if (attempt < attempts && yandexRateLimitedUntil <= Date.now()) await wait(Math.min(8000, 500 * 2 ** (attempt - 1)));
  }
  throw lastError instanceof Error ? lastError : new Error('Network request failed');
}

async function list(path = '', offset = 0): Promise<YandexItem> {
  const url = new URL('https://cloud-api.yandex.net/v1/disk/public/resources');
  url.searchParams.set('public_key', publicKey); url.searchParams.set('path', path);
  url.searchParams.set('limit', '100'); url.searchParams.set('offset', String(offset));
  const response = await fetchWithRetry(url);
  if (!response.ok) throw new Error(`Yandex API ${response.status}: ${await response.text()}`);
  return response.json() as Promise<YandexItem>;
}

async function children(path: string): Promise<YandexItem[]> {
  const root = await list(path);
  const first = root._embedded?.items || [];
  const items = [...first];
  for (let offset = first.length; offset < (root._embedded?.total || 0); offset += 100) {
    items.push(...((await list(path, offset))._embedded?.items || []));
  }
  return items;
}

async function crawl(): Promise<YandexItem[]> {
  const queue = [''];
  const files: YandexItem[] = [];
  while (queue.length) {
    const batch = queue.splice(0, 8);
    const levels = await Promise.all(batch.map(children));
    for (const items of levels) for (const item of items) {
      if (item.type === 'file') files.push(item);
      else queue.push(item.path);
    }
    if ((files.length + queue.length) % 100 < batch.length) console.log(`Discovered ${files.length} files, ${queue.length} folders queued…`);
  }
  return files;
}

function inferKind(item: YandexItem): MaterialKind {
  const name = item.path.toLocaleLowerCase('ru');
  const checks: [RegExp, MaterialKind][] = [
    [/лекц|конспект/, 'lecture'], [/семинар/, 'seminar'], [/экзам|билет|зач[её]т/, 'exam'],
    [/книг|учебник/, 'book'], [/гайд|выжива/, 'guide'], [/дз|домаш|задани/, 'homework'],
  ];
  return materialKindSchema.parse(checks.find(([regex]) => regex.test(name))?.[1] || 'other');
}

async function download(item: YandexItem) {
  const fresh = await list(item.path);
  if (!fresh.file) throw new Error(`No download URL for ${item.path}`);
  const response = await fetchWithRetry(fresh.file);
  if (!response.ok || !response.body) throw new Error(`Download ${response.status}: ${item.path}`);
  await mkdir(join(process.cwd(), 'tmp'), { recursive: true });
  const path = join(process.cwd(), 'tmp', `yandex-${createHash('sha1').update(item.path).digest('hex')}`);
  const hash = createHash('sha256');
  const tee = new Transform({ transform(chunk, _enc, done) { hash.update(chunk); done(null, chunk); } });
  await pipeline(Readable.fromWeb(response.body as any), tee, createWriteStream(path));
  return { path, sha256: hash.digest('hex') };
}

console.log('Scanning the public Yandex Disk…');
let files: YandexItem[];
if (useInventory) {
  try {
    const inventory = JSON.parse(await readFile(inventoryPath, 'utf8')) as { publicKey?: string; files?: YandexItem[] };
    if (inventory.publicKey !== publicKey || !Array.isArray(inventory.files) || !inventory.files.length) throw new Error('Inventory is missing or belongs to another public folder');
    files = inventory.files;
    console.log(`Using saved inventory with ${files.length} files.`);
  } catch (error) {
    console.warn('Saved inventory is unavailable, scanning from scratch:', error);
    files = await crawl();
  }
} else files = await crawl();
await mkdir(join(process.cwd(), 'data'), { recursive: true });
await writeFile(inventoryPath, JSON.stringify({ scannedAt: new Date().toISOString(), publicKey, files }, null, 2));
const bytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
const byCourse = new Map<string, number>();
for (const file of files) { const course = file.path.split('/').filter(Boolean)[0] || 'Корень'; byCourse.set(course, (byCourse.get(course) || 0) + 1); }
console.log(`Found ${files.length} files (${(bytes / 1024 ** 3).toFixed(2)} GiB)`);
console.table([...byCourse].map(([course, count]) => ({ course, files: count })));
console.log(`Inventory saved to ${inventoryPath}`);

if (!publish) {
  console.log('Dry run complete. Add --publish to migrate files to GitHub.');
  process.exit(0);
}

const publisher = new GitHubPublisher();
let existing = await publisher.catalog.read();
const sourcePathBySha = new Map(files.filter((item) => item.sha256).map((item) => [item.sha256!, item.path]));
const pathRepairs = existing.materials
  .filter((material) => sourcePathBySha.has(material.sha256) && material.path !== sourcePathBySha.get(material.sha256))
  .map((material) => ({ ...material, path: sourcePathBySha.get(material.sha256)!, updatedAt: new Date().toISOString() }));
if (pathRepairs.length) {
  console.log(`Repairing full folder paths for ${pathRepairs.length} existing catalog entries…`);
  await publisher.catalog.upsertMany(pathRepairs);
  const repaired = new Map(pathRepairs.map((material) => [material.id, material]));
  existing = { ...existing, materials: existing.materials.map((material) => repaired.get(material.id) || material) };
}
const known = new Set(existing.materials.map((m) => m.sha256).filter(Boolean));
let done = 0; let skipped = 0; let failed = 0;
const sourceSeen = new Set(known);
const candidates: YandexItem[] = [];
for (const item of files) {
  if (item.sha256 && sourceSeen.has(item.sha256)) { skipped += 1; continue; }
  if (item.sha256) sourceSeen.add(item.sha256);
  candidates.push(item);
}
const concurrency = Math.max(1, Math.min(8, Number(process.env.MIGRATION_CONCURRENCY) || 4));
console.log(`Migration queue: ${candidates.length} unique files, ${skipped} duplicates skipped, concurrency ${concurrency}`);
const pending: Awaited<ReturnType<typeof publisher.publish>>[] = [];
async function writeState(lastPath: string, status: 'running' | 'complete' | 'failed' = 'running') {
  await writeFile(join(process.cwd(), 'data', 'import-state.json'), JSON.stringify({
    status, updatedAt: new Date().toISOString(), lastPath, total: files.length,
    unique: candidates.length, done, skipped, failed, pendingCatalog: pending.length,
  }, null, 2));
}
await writeState('', 'running');
async function flushCatalog() {
  if (!pending.length) return;
  const batch = [...pending];
  let lastError: unknown;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      await publisher.catalog.upsertMany(batch);
      pending.splice(0, batch.length);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 6) await wait(Math.min(8000, 500 * 2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

async function migrate(item: YandexItem) {
  const parts = item.path.split('/').filter(Boolean);
  let downloaded: Awaited<ReturnType<typeof download>> | undefined;
  try {
    downloaded = await download(item);
    if (known.has(downloaded.sha256)) return { item, skipped: true as const, sha256: downloaded.sha256 };
    const originalName = basename(item.path);
    const material = await publisher.publish({
      filePath: downloaded.path, originalName, mimeType: item.mime_type || 'application/octet-stream', sha256: downloaded.sha256,
      title: basename(originalName, extname(originalName)).replace(/[_-]+/g, ' '), description: `Импортировано из Яндекс Диска: ${item.path}`,
      course: parts[0] || 'Другое', subject: parts[1] || 'Без предмета', kind: inferKind(item), tags: [], source: 'admin', author: 'Yandex Disk migration',
      sourcePath: item.path,
    }, false);
    return { item, material, sha256: downloaded.sha256 };
  } catch (error) {
    return { item, error };
  } finally {
    if (downloaded) await import('node:fs/promises').then(({ unlink }) => unlink(downloaded!.path).catch(() => undefined));
  }
}

for (let index = 0; index < candidates.length; index += concurrency) {
  const results = await Promise.all(candidates.slice(index, index + concurrency).map(migrate));
  for (const result of results) {
    if ('error' in result) {
      failed += 1; console.error(`[${done + skipped + failed}/${files.length}] ✗ ${result.item.path}:`, result.error);
    } else if ('skipped' in result) {
      skipped += 1;
    } else {
      pending.push(result.material); known.add(result.sha256); done += 1;
      console.log(`[${done + skipped + failed}/${files.length}] ✓ ${result.item.path}`);
    }
  }
  if (pending.length >= 100) await flushCatalog();
  await writeState(results.at(-1)?.item.path || '', 'running');
}
await flushCatalog();
await writeState(candidates.at(-1)?.path || '', failed ? 'failed' : 'complete');
console.log({ done, skipped, failed });
if (failed) process.exitCode = 1;
