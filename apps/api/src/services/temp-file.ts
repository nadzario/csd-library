import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const tempDir = join(process.cwd(), 'tmp');

export async function saveStream(stream: NodeJS.ReadableStream, maxBytes = Infinity, options: { directory?: string; sha256?: string } = {}) {
  const directory = options.directory || tempDir;
  await mkdir(directory, { recursive: true });
  const path = join(directory, randomUUID());
  const hash = createHash('sha256');
  let bytes = 0;
  const tee = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    if (bytes > maxBytes) return callback(Object.assign(new Error('File exceeds upload limit'), { statusCode: 413 }));
    hash.update(chunk); callback(null, chunk);
  } });
  try {
    await pipeline(stream, tee, createWriteStream(path));
    const sha256 = hash.digest('hex');
    if (options.sha256 && sha256 !== options.sha256) throw new Error('SHA-256 mismatch');
    return { path, sha256, cleanup: () => unlink(path).catch(() => undefined) };
  } catch (error) {
    await unlink(path).catch(() => undefined);
    throw error;
  }
}
