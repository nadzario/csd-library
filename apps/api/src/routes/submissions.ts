import { stat } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { materialKindSchema, submissionUpdateSchema } from '@csd/shared';
import { config } from '../config.js';
import { GitHubPublisher } from '../services/github-publisher.js';
import { SubmissionService } from '../services/submissions.js';
import { saveStream } from '../services/temp-file.js';

const required = ['title', 'course', 'subject'] as const;
const clean = (value: string | undefined, max: number) => String(value || '').trim().slice(0, max);

export async function submissionRoutes(
  app: FastifyInstance,
  publisher: GitHubPublisher,
  submissions: SubmissionService,
) {
  app.post('/api/submissions', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (request, reply) => {
    const fields: Record<string, string> = {};
    let upload: Awaited<ReturnType<typeof saveStream>> | undefined;
    let fileName = '';
    let mimeType = 'application/octet-stream';

    try {
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (upload) return reply.code(400).send({ error: 'Можно отправить только один файл' });
          fileName = part.filename;
          mimeType = part.mimetype;
          upload = await saveStream(part.file);
          if (part.file.truncated) return reply.code(413).send({ error: 'Файл превышает серверный лимит' });
        } else fields[part.fieldname] = String(part.value);
      }
      if (fields.company) return reply.code(201).send({ accepted: true });
      if (!upload) return reply.code(400).send({ error: 'Выберите файл' });
      for (const key of required) if (!fields[key]?.trim()) return reply.code(400).send({ error: `Поле ${key} обязательно` });
      const fileSize = (await stat(upload.path)).size;
      if (!fileSize) return reply.code(400).send({ error: 'Пустой файл нельзя отправить' });
      if (fileSize > config.PUBLIC_SUBMISSION_MAX_MB * 1024 ** 2) {
        return reply.code(413).send({ error: `Максимальный размер заявки — ${config.PUBLIC_SUBMISSION_MAX_MB} МБ` });
      }
      const kind = materialKindSchema.safeParse(fields.kind || 'other');
      if (!kind.success) return reply.code(400).send({ error: 'Неизвестный тип материала' });

      const submission = await submissions.create({
        title: clean(fields.title, 180),
        description: clean(fields.description, 4000),
        course: clean(fields.course, 120),
        subject: clean(fields.subject, 180),
        kind: kind.data,
        tags: String(fields.tags || '').split(',').map((tag) => tag.trim().slice(0, 60)).filter(Boolean).slice(0, 20),
        fileName: clean(fileName, 500),
        mimeType: clean(mimeType, 200),
        size: fileSize,
        sha256: upload.sha256,
        submitter: clean(fields.submitter, 180),
      }, upload.path);
      upload = undefined;
      return reply.code(201).send({ accepted: true, id: submission.id });
    } finally {
      await upload?.cleanup();
    }
  });

  app.get('/api/submissions', { onRequest: [app.authenticate] }, async () => submissions.list());

  app.get<{ Params: { id: string } }>('/api/submissions/:id/file', {
    onRequest: [app.authenticate],
  }, async (request, reply) => {
    const submission = await submissions.find(request.params.id);
    if (!submission) return reply.code(404).send({ error: 'Заявка не найдена' });
    const encodedName = encodeURIComponent(submission.fileName);
    return reply
      .type(submission.mimeType)
      .header('content-length', submission.size)
      .header('content-disposition', `inline; filename*=UTF-8''${encodedName}`)
      .send(submissions.stream(submission.id));
  });

  app.patch<{ Params: { id: string } }>('/api/submissions/:id', {
    onRequest: [app.authenticate],
  }, async (request, reply) => {
    const parsed = submissionUpdateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Проверьте поля материала' });
    const submission = await submissions.update(request.params.id, parsed.data);
    return submission || reply.code(404).send({ error: 'Заявка не найдена' });
  });

  app.post<{ Params: { id: string } }>('/api/submissions/:id/approve', {
    onRequest: [app.authenticate],
  }, async (request, reply) => {
    const submission = await submissions.find(request.params.id);
    if (!submission) return reply.code(404).send({ error: 'Заявка не найдена' });
    const material = await publisher.publish({
      filePath: submissions.filePath(submission.id),
      originalName: submission.fileName,
      mimeType: submission.mimeType,
      sha256: submission.sha256,
      title: submission.title,
      description: submission.description,
      course: submission.course,
      subject: submission.subject,
      kind: submission.kind,
      tags: submission.tags,
      source: 'admin',
      author: submission.submitter ? `Предложил: ${submission.submitter}` : 'Предложено через сайт',
    });
    await submissions.remove(submission.id);
    return material;
  });

  app.delete<{ Params: { id: string } }>('/api/submissions/:id', {
    onRequest: [app.authenticate],
  }, async (request, reply) => {
    const removed = await submissions.remove(request.params.id);
    if (!removed) return reply.code(404).send({ error: 'Заявка не найдена' });
    return reply.code(204).send();
  });
}
