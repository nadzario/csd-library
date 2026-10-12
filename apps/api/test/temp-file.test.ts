import { createHash } from 'node:crypto';
import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { saveStream } from '../src/services/temp-file.js';

describe('streamed uploads', () => {
  it('verifies the expected checksum and removes corrupt downloads', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'csd-checksum-'));
    try {
      await expect(saveStream(Readable.from(['corrupt']), 1024, { directory, sha256: 'a'.repeat(64) })).rejects.toThrow('SHA-256 mismatch');
      expect(await readdir(directory)).toEqual([]);
      const saved = await saveStream(Readable.from(['verified']), 1024, { directory, sha256: createHash('sha256').update('verified').digest('hex') });
      await saved.cleanup();
      expect(await readdir(directory)).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('writes, hashes, and removes a file', async () => {
    const value = 'CSD material';
    const saved = await saveStream(Readable.from([value]));
    expect(saved.sha256).toBe(createHash('sha256').update(value).digest('hex'));
    await expect(access(saved.path)).resolves.toBeUndefined();
    await saved.cleanup();
    await expect(access(saved.path)).rejects.toThrow();
  });
});
