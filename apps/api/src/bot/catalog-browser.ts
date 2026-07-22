import { createHash } from 'node:crypto';
import type { Material } from '@csd/shared';
import type { CatalogService } from '../services/catalog.js';

export type NamedCount = { name: string; key: string; count: number };

export function callbackKey(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 10);
}

export class CatalogBrowser {
  private cached: Material[] = [];
  private expiresAt = 0;

  constructor(private readonly catalog: CatalogService, private readonly ttlMs = 5 * 60_000) {}

  invalidate() { this.expiresAt = 0; }

  async materials(): Promise<Material[]> {
    if (Date.now() >= this.expiresAt) {
      this.cached = (await this.catalog.read()).materials;
      this.expiresAt = Date.now() + this.ttlMs;
    }
    return this.cached;
  }

  async courses(): Promise<NamedCount[]> {
    const counts = new Map<string, number>();
    for (const material of await this.materials()) counts.set(material.course, (counts.get(material.course) || 0) + 1);
    return [...counts].map(([name, count]) => ({ name, count, key: callbackKey(name) })).sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
  }

  async course(key: string) { return (await this.courses()).find((item) => item.key === key); }

  async subjects(course: string): Promise<NamedCount[]> {
    const counts = new Map<string, number>();
    for (const material of await this.materials()) if (material.course === course) counts.set(material.subject, (counts.get(material.subject) || 0) + 1);
    return [...counts].map(([name, count]) => ({ name, count, key: callbackKey(`${course}\0${name}`) })).sort((a, b) => a.name.localeCompare(b.name, 'ru', { numeric: true }));
  }

  async subject(course: string, key: string) { return (await this.subjects(course)).find((item) => item.key === key); }

  async bySubject(course: string, subject: string) {
    return (await this.materials()).filter((item) => item.course === course && item.subject === subject).sort((a, b) => a.title.localeCompare(b.title, 'ru', { numeric: true }));
  }

  async find(key: string) { return (await this.materials()).find((item) => callbackKey(item.id) === key); }

  async search(query: string, limit = 12) {
    const words = query.toLocaleLowerCase('ru').split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return (await this.materials()).filter((item) => {
      const text = [item.title, item.description, item.course, item.subject, item.fileName, ...item.tags].join(' ').toLocaleLowerCase('ru');
      return words.every((word) => text.includes(word));
    }).slice(0, limit);
  }
}
