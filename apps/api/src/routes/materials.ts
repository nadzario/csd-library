import type { FastifyInstance } from 'fastify';
import { materialKindSchema } from '@csd/shared';
import { config } from '../config.js';
import { GitHubPublisher } from '../services/github-publisher.js';
import { saveStream } from '../services/temp-file.js';

export async function materialRoutes(app: FastifyInstance, publisher: GitHubPublisher) {
  app.get('/api/catalog', async (_request, reply) => reply.header('cache-control', 'public, max-age=60').send(await publisher.catalog.read()));
  app.get('/api/health', async () => ({ ok: true, github: config.githubReady, bot: Boolean(config.TELEGRAM_BOT_TOKEN) }));
  app.post('/api/materials', { onRequest: [app.authenticate] }, async (request, reply) => {
    const fields: Record<string, string> = {};
    let upload: Awaited<ReturnType<typeof saveStream>> | undefined;
    let fileName = ''; let mimeType = 'application/octet-stream';
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (upload) return reply.code(400).send({ error: 'Можно загрузить только один файл' });
        fileName = part.filename; mimeType = part.mimetype; upload = await saveStream(part.file);
        if (part.file.truncated) { await upload.cleanup(); upload = undefined; return reply.code(413).send({ error: 'Файл превышает лимит 2 ГБ' }); }
      } else fields[part.fieldname] = String(part.value);
    }
    if (!upload) return reply.code(400).send({ error: 'Файл обязателен' });
    try {
      for (const key of ['title', 'course', 'subject']) if (!fields[key]?.trim()) return reply.code(400).send({ error: `Поле ${key} обязательно` });
      const material = await publisher.publish({
        filePath: upload.path, originalName: fileName, mimeType, sha256: upload.sha256,
        title: fields.title!, description: fields.description || '', course: fields.course!, subject: fields.subject!,
        kind: materialKindSchema.parse(fields.kind || 'other'), tags: (fields.tags || '').split(',').map((x) => x.trim()).filter(Boolean),
        source: 'admin', author: request.user && typeof request.user === 'object' ? 'admin' : undefined,
      });
      return reply.code(201).send(material);
    } finally { await upload.cleanup(); }
  });
}
