import { describe, expect, it } from 'vitest';
import { assertCredentials } from '../src/lib/credentials.js';
const valid = { NODE_ENV: 'production', ADMIN_PASSWORD: 'unique-password-for-this-test', JWT_SECRET: 'a-test-only-secret-longer-than-32-characters' };
describe('production credentials', () => {
  it('rejects both known admin passwords', () => {
    for (const ADMIN_PASSWORD of ['change-this-password', 'change-this-long-password']) expect(() => assertCredentials({ ...valid, ADMIN_PASSWORD })).toThrow();
  });
  it('rejects both known JWT keys', () => {
    for (const JWT_SECRET of ['development-secret-must-have-32-chars', 'replace-with-at-least-32-random-characters']) expect(() => assertCredentials({ ...valid, JWT_SECRET })).toThrow();
  });
  it('allows configured production credentials', () => {
    expect(() => assertCredentials(valid)).not.toThrow();
  });
});
