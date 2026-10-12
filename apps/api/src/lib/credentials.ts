const placeholders = new Set([
  'change-this-password', 'change-this-long-password',
  'development-secret-must-have-32-chars', 'replace-with-at-least-32-random-characters',
]);

export function assertCredentials(config: { ADMIN_PASSWORD: string; JWT_SECRET: string }) {
  if (placeholders.has(config.ADMIN_PASSWORD) || placeholders.has(config.JWT_SECRET)) {
    throw new Error('Replace default and example credentials before starting the API');
  }
}
