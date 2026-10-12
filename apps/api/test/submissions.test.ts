import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { SubmissionService } from '../src/services/submissions.js';
import { saveStream } from '../src/services/temp-file.js';
import { Readable } from 'node:stream';
import { config } from '../src/config.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('submission moderation queue', () => {
  it('accepts uploads when temp storage and queue are on different filesystems', async () => {
    const root = await mkdtemp(join(tmpdir(), 'csd-cross-device-'));
    roots.push(root);
    const saved = await saveStream(Readable.from(['lecture']));
    const service = new SubmissionService(join(root, 'queue'));
    try {
      const created = await service.create({ title: 'x', description: '', course: 'x', subject: 'x', kind: 'other', tags: [], fileName: 'notes.txt', mimeType: 'text/plain', size: 7, sha256: saved.sha256, submitter: '' }, saved.path);
      expect(await readFile(service.filePath(created.id), 'utf8')).toBe('lecture');
      await expect(access(saved.path)).rejects.toThrow();
    } finally { await saved.cleanup(); }
  });

  it('reserves disk capacity before reading uploads and releases reservations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'csd-quota-'));
    roots.push(root);
    const service = new SubmissionService(root);
    const original = { maxMb: config.PUBLIC_QUEUE_MAX_MB, concurrency: config.PUBLIC_UPLOAD_CONCURRENCY, uploadMb: config.PUBLIC_SUBMISSION_MAX_MB };
    config.PUBLIC_QUEUE_MAX_MB = 1; config.PUBLIC_SUBMISSION_MAX_MB = 1; config.PUBLIC_UPLOAD_CONCURRENCY = 2;
    try {
      const release = await service.reserveUpload();
      await expect(service.reserveUpload()).rejects.toMatchObject({ statusCode: 503 });
      release();
      const retryRelease = await service.reserveUpload(); retryRelease();
      config.PUBLIC_UPLOAD_CONCURRENCY = 1; config.PUBLIC_QUEUE_MAX_MB = 10;
      const singleRelease = await service.reserveUpload();
      await expect(service.reserveUpload()).rejects.toMatchObject({ statusCode: 503 }); singleRelease();
    } finally {
      config.PUBLIC_QUEUE_MAX_MB = original.maxMb; config.PUBLIC_UPLOAD_CONCURRENCY = original.concurrency; config.PUBLIC_SUBMISSION_MAX_MB = original.uploadMb;
    }
  });
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
