import { describe, expect, it } from 'vitest';
import { catalogSchema, formatBytes, slugify } from './index.js';

describe('shared catalog model', () => {
  it('creates stable unicode slugs', () => expect(slugify('1 курс / Матан')).toBe('1-курс-матан'));
  it('formats sizes', () => expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 МБ'));
  it('rejects an invalid catalog', () => expect(() => catalogSchema.parse({ version: 2, materials: [] })).toThrow());
});
