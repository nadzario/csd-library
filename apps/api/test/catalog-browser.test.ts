import { describe, expect, it } from 'vitest';
import type { Catalog } from '@csd/shared';
import { callbackKey, CatalogBrowser } from '../src/bot/catalog-browser.js';

const now = new Date().toISOString();
const catalog: Catalog = {
  version: 1, generatedAt: now, materials: [
    { id: 'one', title: 'Лекции по матану', description: 'Пределы', course: '1 курс', subject: 'Математический анализ', kind: 'lecture', tags: ['экзамен'], path: '/one.pdf', fileName: 'one.pdf', mimeType: 'application/pdf', size: 10, sha256: 'a', downloadUrl: 'https://example.com/one.pdf', source: 'admin', addedAt: now, updatedAt: now },
    { id: 'two', title: 'Задачи', description: '', course: '1 курс', subject: 'Математический анализ', kind: 'homework', tags: [], path: '/two.pdf', fileName: 'two.pdf', mimeType: 'application/pdf', size: 20, sha256: 'b', downloadUrl: 'https://example.com/two.pdf', source: 'admin', addedAt: now, updatedAt: now },
  ],
};

describe('Telegram catalog browser', () => {
  const browser = new CatalogBrowser({ read: async () => catalog } as any);
  it('groups courses and subjects', async () => {
    expect(await browser.courses()).toEqual([{ name: '1 курс', key: callbackKey('1 курс'), count: 2 }]);
    expect((await browser.subjects('1 курс'))[0]?.count).toBe(2);
  });
  it('searches metadata and tags', async () => {
    expect((await browser.search('матан экзамен')).map((item) => item.id)).toEqual(['one']);
  });
  it('resolves callback-safe material keys', async () => {
    expect((await browser.find(callbackKey('two')))?.title).toBe('Задачи');
    expect(callbackKey('очень длинная строка')).toHaveLength(10);
  });
});
