import 'dotenv/config';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
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
const inventoryPath = join(process.cwd(), 'data', 'yandex-inventory.json');

async function list(path = '', offset = 0): Promise<YandexItem> {
  const url = new URL('https://cloud-api.yandex.net/v1/disk/public/resources');
  url.searchParams.set('public_key', publicKey); url.searchParams.set('path', path);
  url.searchParams.set('limit', '100'); url.searchParams.set('offset', String(offset));
  const response = await fetch(url);
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
  const response = await fetch(fresh.file);
  if (!response.ok || !response.body) throw new Error(`Download ${response.status}: ${item.path}`);
  await mkdir(join(process.cwd(), 'tmp'), { recursive: true });
  const path = join(process.cwd(), 'tmp', `yandex-${createHash('sha1').update(item.path).digest('hex')}`);
  const hash = createHash('sha256');
  const tee = new Transform({ transform(chunk, _enc, done) { hash.update(chunk); done(null, chunk); } });
  await pipeline(Readable.fromWeb(response.body as any), tee, createWriteStream(path));
  return { path, sha256: hash.digest('hex') };
}

console.log('Scanning the public Yandex Disk…');
const files = await crawl();
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
const existing = await publisher.catalog.read();
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
let pending: Awaited<ReturnType<typeof publisher.publish>>[] = [];
async function flushCatalog() {
  if (!pending.length) return;
  await publisher.catalog.upsertMany(pending);
  pending = [];
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
      await writeFile(join(process.cwd(), 'data', 'import-state.json'), JSON.stringify({ lastPath: result.item.path, done, skipped, failed }, null, 2));
    } else if ('skipped' in result) {
      skipped += 1;
    } else {
      pending.push(result.material); known.add(result.sha256); done += 1;
      console.log(`[${done + skipped + failed}/${files.length}] ✓ ${result.item.path}`);
    }
  }
  if (pending.length >= 100) await flushCatalog();
}
await flushCatalog();
console.log({ done, skipped, failed });
if (failed) process.exitCode = 1;
