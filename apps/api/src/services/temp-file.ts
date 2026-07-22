import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const tempDir = join(process.cwd(), 'tmp');

export async function saveStream(stream: NodeJS.ReadableStream) {
  await mkdir(tempDir, { recursive: true });
  const path = join(tempDir, randomUUID());
  const hash = createHash('sha256');
  const tee = new Transform({ transform(chunk, _encoding, callback) { hash.update(chunk); callback(null, chunk); } });
  await pipeline(stream, tee, createWriteStream(path));
  return { path, sha256: hash.digest('hex'), cleanup: () => unlink(path).catch(() => undefined) };
}
