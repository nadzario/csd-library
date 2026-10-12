import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { submissionRoutes } from '../src/routes/submissions.js';
import { materialRoutes } from '../src/routes/materials.js';
import { SubmissionService } from '../src/services/submissions.js';
import { GitHubPublisher } from '../src/services/github-publisher.js';
import { config } from '../src/config.js';
import { saveStream } from '../src/services/temp-file.js';

const payload = (size: number) => Buffer.concat([
  Buffer.from('--test\r\nContent-Disposition: form-data; name="file"; filename="evil.pdf"\r\nContent-Type: text/html\r\n\r\n'),
  Buffer.alloc(size, 65), Buffer.from('\r\n--test--\r\n'),
]);

describe('security regressions', () => {
  it('rejects oversized public uploads during parsing without enqueuing a file', async () => {
    const app = Fastify();
    app.decorate('authenticate', async () => {});
    await app.register(multipart, { limits: { fileSize: 2 * 1024 ** 3 } });
    const original = config.PUBLIC_SUBMISSION_MAX_MB;
    config.PUBLIC_SUBMISSION_MAX_MB = 1;
    try {
      const create = vi.fn();
      await app.register((instance) => submissionRoutes(instance, {} as GitHubPublisher, { reserveUpload: async () => () => {}, create } as unknown as SubmissionService));
      const result = await app.inject({ method: 'POST', url: '/api/submissions', headers: { 'content-type': 'multipart/form-data; boundary=test' }, payload: payload(2 * 1024 ** 2) });
      expect(result.statusCode).toBe(413);
      expect(create).not.toHaveBeenCalled();
    } finally { config.PUBLIC_SUBMISSION_MAX_MB = original; await app.close(); }
  });

  it('cleans partial files after byte-limit and source failures', async () => {
    const directory = await mkdtemp('/tmp/csd-stream-failure-');
    try {
      await expect(saveStream(Readable.from([Buffer.alloc(8), Buffer.alloc(8)]), 10, { directory })).rejects.toMatchObject({ statusCode: 413 });
      const broken = Readable.from((async function* () { yield Buffer.from('partial'); throw new Error('disconnected'); })());
      await expect(saveStream(broken, Infinity, { directory })).rejects.toThrow('disconnected');
      expect(await readdir(directory)).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('does not serve attacker MIME types on either file endpoint', async () => {
    const root = await mkdtemp(join(process.cwd(), 'tmp', 'csd-security-'));
    const submissions = new SubmissionService(root);
    const app = Fastify();
    app.decorate('authenticate', async () => {});
    const file = { fileName: 'evil.pdf', mimeType: 'text/html', size: 25, title: 'x', description: '', course: 'x', subject: 'x', kind: 'other' as const, tags: [], sha256: 'a'.repeat(64), submitter: '' };
    const saved = await saveStream(Readable.from(['<script>alert(1)</script>']));
    const submission = await submissions.create(file, saved.path);
    const publisher = { catalog: { read: async () => ({ materials: [{ ...file, id: 'evil', downloadUrl: 'https://github.com/nadzario/csd-early/releases/download/library/evil.pdf' }] }) } } as unknown as GitHubPublisher;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<script>alert(1)</script>')));
    try {
      await app.register((instance) => submissionRoutes(instance, publisher, submissions));
      await app.register((instance) => materialRoutes(instance, publisher));
      for (const url of [`/api/submissions/${submission.id}/file`, '/api/admin/materials/evil/file']) {
        const response = await app.inject(url);
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('application/pdf');
        expect(response.headers['x-content-type-options']).toBe('nosniff');
        expect(response.headers['content-security-policy']).toContain('sandbox');
      }
    } finally { vi.unstubAllGlobals(); await app.close(); await rm(root, { recursive: true, force: true }); }
  });

  it('separates clients only behind an explicitly trusted proxy', async () => {
    for (const trusted of [false, ['127.0.0.1']] as const) {
      const app = Fastify({ trustProxy: trusted === false ? false : [...trusted] });
      await app.register(rateLimit, { max: 1, timeWindow: '1 minute' });
      app.get('/', async (request) => ({ ip: request.ip }));
      try {
        const first = await app.inject({ url: '/', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '192.0.2.1' } });
        const second = await app.inject({ url: '/', remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': '192.0.2.2' } });
        expect(first.statusCode).toBe(200);
        expect(second.statusCode).toBe(trusted ? 200 : 429);
        const spoof = await app.inject({ url: '/', remoteAddress: '198.51.100.1', headers: { 'x-forwarded-for': '192.0.2.3' } });
        expect(spoof.json().ip).toBe('198.51.100.1');
      } finally { await app.close(); }
    }
  });
});
