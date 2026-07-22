import type { FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const same = (left: string, right: string) => {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { password?: string } }>('/api/auth/login', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (!request.body?.password || !same(request.body.password, config.ADMIN_PASSWORD)) return reply.code(401).send({ error: 'Неверный пароль' });
    return { token: await reply.jwtSign({ role: 'admin' }, { expiresIn: '12h' }) };
  });
}
