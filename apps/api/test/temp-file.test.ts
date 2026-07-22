import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { saveStream } from '../src/services/temp-file.js';

describe('streamed uploads', () => {
  it('writes, hashes, and removes a file', async () => {
    const value = 'CSD material';
    const saved = await saveStream(Readable.from([value]));
    expect(saved.sha256).toBe(createHash('sha256').update(value).digest('hex'));
    await expect(access(saved.path)).resolves.toBeUndefined();
    await saved.cleanup();
    await expect(access(saved.path)).rejects.toThrow();
  });
});
