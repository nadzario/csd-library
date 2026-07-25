import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { SubmissionService } from '../src/services/submissions.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('submission moderation queue', () => {
  it('persists, edits and removes a pending file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'csd-submissions-'));
    roots.push(root);
    const temporary = join(root, 'upload');
    await writeFile(temporary, 'lecture');
    const service = new SubmissionService(join(root, 'queue'));
    const created = await service.create({
      title: 'Конспект',
      description: '',
      course: '2 курс',
      subject: 'Алгебра',
      kind: 'lecture',
      tags: [],
      fileName: 'notes.txt',
      mimeType: 'text/plain',
      size: 7,
      sha256: 'a'.repeat(64),
      submitter: '@student',
    }, temporary);

    expect(await service.list()).toHaveLength(1);
    expect((await service.update(created.id, { description: 'Проверенное описание' }))?.description).toBe('Проверенное описание');
    await expect(service.remove(created.id)).resolves.toMatchObject({ id: created.id });
    await expect(service.list()).resolves.toEqual([]);
  });
});
