import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { authRoutes } from './routes/auth.js';
import { materialRoutes } from './routes/materials.js';
import { submissionRoutes } from './routes/submissions.js';
import { GitHubPublisher } from './services/github-publisher.js';
import { SubmissionService } from './services/submissions.js';
import { createBot } from './bot/index.js';

const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 });
const siteOrigin = new URL(config.PUBLIC_SITE_URL).origin;
await app.register(cors, { origin: config.NODE_ENV === 'production' ? siteOrigin : true });
await app.register(jwt, { secret: config.JWT_SECRET });
await app.register(multipart, { limits: { files: 1, fileSize: 2 * 1024 * 1024 * 1024, fields: 12 } });
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
app.decorate('authenticate', async (request, reply) => {
  try { await request.jwtVerify(); }
  catch { await reply.code(401).send({ error: 'Требуется авторизация' }); }
});

const publisher = new GitHubPublisher();
const submissions = new SubmissionService();
await app.register(authRoutes);
await app.register((instance) => materialRoutes(instance, publisher));
await app.register((instance) => submissionRoutes(instance, publisher, submissions));

const bot = createBot(publisher);
const shutdown = async () => {
  bot?.stop();
  await app.close();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.PORT, host: '0.0.0.0' });
if (bot) {
  await bot.api.setMyCommands([
    { command: 'materials', description: 'Смотреть материалы' },
    { command: 'search', description: 'Найти материал' },
    { command: 'site', description: 'Открыть сайт' },
    { command: 'admin', description: 'Панель администратора' },
    { command: 'help', description: 'Помощь' },
  ]).catch((error) => app.log.warn(error, 'Could not update Telegram commands'));
  void bot.start({ onStart: ({ username }) => app.log.info(`Telegram bot @${username} started`) });
}
