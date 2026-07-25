import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import {
  materialAdminUpdateSchema, materialKindSchema, type Material,
} from '@csd/shared';
import { config } from '../config.js';
import { buildMaterialPath, folderOf } from '../lib/material-path.js';
import { GitHubPublisher } from '../services/github-publisher.js';
import { saveStream } from '../services/temp-file.js';

export async function materialRoutes(app: FastifyInstance, publisher: GitHubPublisher) {
  let cache: { materials: Material[]; expiresAt: number } | undefined;
  const loadMaterials = async () => {
    if (cache && cache.expiresAt > Date.now()) return cache.materials;
    const materials = (await publisher.catalog.read()).materials;
    cache = { materials, expiresAt: Date.now() + 60_000 };
    return materials;
  };

  app.get('/api/catalog', async (_request, reply) => reply.header('cache-control', 'public, max-age=60').send(await publisher.catalog.read()));
  app.get('/api/health', async () => ({ ok: true, github: config.githubReady, bot: Boolean(config.TELEGRAM_BOT_TOKEN) }));

  app.get<{ Querystring: { query?: string; limit?: string; offset?: string } }>('/api/admin/materials', {
    onRequest: [app.authenticate],
  }, async (request) => {
    const query = String(request.query.query || '').trim().toLocaleLowerCase('ru');
    const limit = Math.min(Math.max(Number.parseInt(request.query.limit || '50', 10) || 50, 1), 100);
    const offset = Math.max(Number.parseInt(request.query.offset || '0', 10) || 0, 0);
    const all = await loadMaterials();
    const filtered = (query ? all.filter((material) => [
      material.title, material.description, material.course, material.subject,
      material.path, material.fileName, ...material.tags,
    ].some((value) => value.toLocaleLowerCase('ru').includes(query))) : [...all])
      .sort((left, right) => left.path.localeCompare(right.path, 'ru', { numeric: true }));
    return { items: filtered.slice(offset, offset + limit), total: filtered.length, offset, limit };
  });

  app.get<{ Querystring: { path?: string } }>('/api/admin/folders', {
    onRequest: [app.authenticate],
  }, async (request, reply) => {
    const parts = String(request.query.path || '').replaceAll('\\', '/').split('/').map((part) => part.trim()).filter(Boolean);
    if (parts.some((part) => part === '.' || part === '..' || part.includes('\0'))) {
      return reply.code(400).send({ error: 'Некорректный путь папки' });
    }
    const children = new Map<string, number>();
    for (const material of await loadMaterials()) {
      const materialParts = folderOf(material.path, material.fileName).split('/').filter(Boolean);
      if (!parts.every((part, index) => materialParts[index] === part)) continue;
      const child = materialParts[parts.length];
      if (child) children.set(child, (children.get(child) || 0) + 1);
    }
    return {
      path: parts.join('/'),
      folders: [...children].map(([name, count]) => ({ name, count }))
        .sort((left, right) => left.name.localeCompare(right.name, 'ru', { numeric: true })),
    };
  });

  app.get<{ Params: { id: string } }>('/api/admin/materials/:id/file', {
    onRequest: [app.authenticate],
  }, async (request, reply) => {
    const material = (await loadMaterials()).find((item) => item.id === request.params.id);
    if (!material) return reply.code(404).send({ error: 'Материал не найден' });
    const upstream = await fetch(material.downloadUrl);
    if (!upstream.ok || !upstream.body) return reply.code(502).send({ error: 'GitHub не отдал файл' });
    const encodedName = encodeURIComponent(material.fileName);
    const length = upstream.headers.get('content-length');
    if (length) reply.header('content-length', length);
    return reply
      .type(material.mimeType)
      .header('cache-control', 'private, max-age=300')
      .header('content-disposition', `inline; filename*=UTF-8''${encodedName}`)
      .send(Readable.fromWeb(upstream.body as any));
  });

  app.patch<{ Params: { id: string } }>('/api/admin/materials/:id', {
    onRequest: [app.authenticate],
  }, async (request, reply) => {
    const parsed = materialAdminUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Проверьте поля материала' });
    const current = (await loadMaterials()).find((item) => item.id === request.params.id);
    if (!current) return reply.code(404).send({ error: 'Материал не найден' });
    const { folderPath, ...metadata } = parsed.data;
    const course = metadata.course || current.course;
    const subject = metadata.subject || current.subject;
    let path: string;
    try {
      path = buildMaterialPath(folderPath ?? folderOf(current.path, current.fileName), current.fileName, course, subject);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'Некорректный путь' });
    }
    const material = {
      ...current, ...metadata, course, subject, path, updatedAt: new Date().toISOString(),
    };
    await publisher.catalog.upsert(material);
    cache = undefined;
    return material;
  });

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
        sourcePath: buildMaterialPath(fields.folderPath, fileName, fields.course!, fields.subject!),
        source: 'admin', author: request.user && typeof request.user === 'object' ? 'admin' : undefined,
      });
      cache = undefined;
      return reply.code(201).send(material);
    } finally { await upload.cleanup(); }
  });
}
