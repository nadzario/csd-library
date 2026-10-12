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

const app = Fastify({
  logger: true, bodyLimit: 1024 * 1024,
  requestTimeout: 300_000,
  trustProxy: config.TRUSTED_PROXIES.trim()
    ? config.TRUSTED_PROXIES.split(',').map((address) => address.trim())
    : false,
});
const siteOrigin = new URL(config.PUBLIC_SITE_URL).origin;
await app.register(cors, { origin: config.NODE_ENV === 'production' ? siteOrigin : true });
await app.register(jwt, { secret: config.JWT_SECRET, sign: { algorithm: 'HS256' }, verify: { algorithms: ['HS256'] } });
await app.register(multipart, { limits: { files: 1, fileSize: 2 * 1024 * 1024 * 1024, fields: 12 } });
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
app.decorate('authenticate', async (request, reply) => {
  try {
    const user = await request.jwtVerify<{ role: string }>();
    if (user.role !== 'admin') await reply.code(403).send({ error: 'Нет доступа' });
  }
  catch { await reply.code(401).send({ error: 'Требуется авторизация' }); }
});

const publisher = new GitHubPublisher();
const submissions = new SubmissionService();
await app.register(authRoutes);
await app.register((instance) => materialRoutes(instance, publisher));
await app.register((instance) => submissionRoutes(instance, publisher, submissions));

const bot = createBot(publisher);
const shutdown = async () => {
  if (bot?.isRunning()) await bot.stop();
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
    { command: 'admin', description: 'Публикация материалов' },
    { command: 'help', description: 'Помощь' },
  ]).catch((error) => app.log.warn(error, 'Could not update Telegram commands'));
  void bot.start({ onStart: ({ username }) => app.log.info(`Telegram bot @${username} started`) })
    .catch(() => app.log.error('Telegram polling stopped; check bot credentials and network access'));
}
