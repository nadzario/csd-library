import { Octokit } from '@octokit/rest';
import { catalogSchema, emptyCatalog, type Catalog, type Material } from '@csd/shared';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { config } from '../config.js';

export class CatalogService {
  constructor(private readonly octokit?: Octokit) {}

  async read(): Promise<Catalog> {
    if (!this.octokit || !config.githubReady) {
      try { return catalogSchema.parse(JSON.parse(await readFile(resolve('data/catalog.json'), 'utf8'))); }
      catch { return emptyCatalog(); }
    }
    try {
      const result = await this.octokit.rest.repos.getContent({ owner: config.GITHUB_OWNER, repo: config.GITHUB_CATALOG_REPO, path: 'catalog.json' });
      if (!('content' in result.data)) return emptyCatalog();
      let json: string;
      if (result.data.content) json = Buffer.from(result.data.content, 'base64').toString('utf8');
      else if (result.data.download_url) {
        const raw = await fetch(result.data.download_url, { headers: { Authorization: `Bearer ${config.GITHUB_TOKEN}` } });
        if (!raw.ok) throw new Error(`Catalog download failed: ${raw.status}`);
        json = await raw.text();
      } else return emptyCatalog();
      return catalogSchema.parse(JSON.parse(json));
    } catch (error: any) {
      if (error.status === 404) return emptyCatalog();
      throw error;
    }
  }

  async upsert(material: Material): Promise<Catalog> {
    return this.upsertMany([material]);
  }

  async upsertMany(incoming: Material[]): Promise<Catalog> {
    if (!this.octokit) throw new Error('GitHub is not configured');
    const current = await this.read();
    const ids = new Set(incoming.map((item) => item.id));
    const materials = current.materials.filter((item) => !ids.has(item.id));
    materials.push(...incoming);
    const next: Catalog = { version: 1, generatedAt: new Date().toISOString(), materials };
    let sha: string | undefined;
    try {
      const existing = await this.octokit.rest.repos.getContent({ owner: config.GITHUB_OWNER, repo: config.GITHUB_CATALOG_REPO, path: 'catalog.json' });
      if ('sha' in existing.data) sha = existing.data.sha;
    } catch (error: any) { if (error.status !== 404) throw error; }
    await this.octokit.rest.repos.createOrUpdateFileContents({
      owner: config.GITHUB_OWNER, repo: config.GITHUB_CATALOG_REPO, path: 'catalog.json',
      message: incoming.length === 1 ? `catalog: add ${incoming[0]!.title}` : `catalog: import ${incoming.length} materials`,
      content: Buffer.from(JSON.stringify(next, null, 2)).toString('base64'), sha,
    });
    await this.writeCompressed(next);
    return next;
  }

  async writeCompressed(catalog: Catalog) {
    if (!this.octokit) throw new Error('GitHub is not configured');
    const content = gzipSync(Buffer.from(JSON.stringify(catalog)), { level: 9 });
    let sha: string | undefined;
    try {
      const existing = await this.octokit.rest.repos.getContent({
        owner: config.GITHUB_OWNER, repo: config.GITHUB_CATALOG_REPO, path: 'catalog.json.gz',
      });
      if ('sha' in existing.data) sha = existing.data.sha;
    } catch (error: any) { if (error.status !== 404) throw error; }
    await this.octokit.rest.repos.createOrUpdateFileContents({
      owner: config.GITHUB_OWNER, repo: config.GITHUB_CATALOG_REPO, path: 'catalog.json.gz',
      message: `catalog: compressed snapshot (${catalog.materials.length} materials)`,
      content: content.toString('base64'), sha,
    });
    return content.length;
  }
}
