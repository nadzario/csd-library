import { Octokit } from '@octokit/rest';
import { catalogSchema, emptyCatalog, type Catalog, type Material } from '@csd/shared';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { config } from '../config.js';

export class CatalogService {
  private mutation: Promise<unknown> = Promise.resolve();
  constructor(private readonly octokit?: Octokit) {}

  private async readRemote(ref: string): Promise<Catalog> {
    try {
      const result = await this.octokit!.rest.repos.getContent({
        owner: config.GITHUB_OWNER, repo: config.GITHUB_CATALOG_REPO, path: 'catalog.json', ref,
      });
      if (!('content' in result.data)) throw new Error('catalog.json is not a file');
      let json: string;
      if (result.data.content) json = Buffer.from(result.data.content, 'base64').toString('utf8');
      else if (result.data.download_url) {
        const url = new URL(result.data.download_url);
        if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com' || url.username || url.password) {
          throw new Error('Unexpected catalog download destination');
        }
        const raw = await fetch(url, {
          headers: { Authorization: `Bearer ${config.GITHUB_TOKEN}` },
          redirect: 'error', signal: AbortSignal.timeout(30_000),
        });
        if (!raw.ok) throw new Error(`Catalog download failed: ${raw.status}`);
        json = await raw.text();
      } else throw new Error('GitHub did not provide catalog content');
      return catalogSchema.parse(JSON.parse(json));
    } catch (error: any) {
      if (error.status === 404) return emptyCatalog();
      throw error;
    }
  }

  async read(): Promise<Catalog> {
    if (!this.octokit || !config.githubReady) {
      try { return catalogSchema.parse(JSON.parse(await readFile(resolve(config.LOCAL_CATALOG_PATH), 'utf8'))); }
      catch (error: any) {
        if (error.code === 'ENOENT') return emptyCatalog();
        throw error;
      }
    }
    return this.readRemote(config.GITHUB_CATALOG_BRANCH);
  }

  async upsert(material: Material): Promise<Catalog> {
    return this.upsertMany([material]);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(operation);
    this.mutation = next.catch(() => undefined);
    return next;
  }

  private async commit(incoming: Material[]): Promise<{ catalog: Catalog; compressedBytes: number }> {
    if (!this.octokit || !config.githubReady) throw new Error('GitHub is not configured');
    const owner = config.GITHUB_OWNER; const repo = config.GITHUB_CATALOG_REPO;
    const ref = `heads/${config.GITHUB_CATALOG_BRANCH}`;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const head = await this.octokit.rest.git.getRef({ owner, repo, ref });
      const parent = head.data.object.sha;
      // Read and merge against the SAME immutable commit we will use as parent.
      const current = await this.readRemote(parent);
      const ids = new Set(incoming.map((item) => item.id));
      const catalog = catalogSchema.parse({
        version: 1, generatedAt: new Date().toISOString(),
        materials: [...current.materials.filter((item) => !ids.has(item.id)), ...incoming],
      });
      const json = Buffer.from(JSON.stringify(catalog, null, 2));
      const gzip = gzipSync(json, { level: 9 });
      const [base, plainBlob, compressedBlob] = await Promise.all([
        this.octokit.rest.git.getCommit({ owner, repo, commit_sha: parent }),
        this.octokit.rest.git.createBlob({ owner, repo, encoding: 'base64', content: json.toString('base64') }),
        this.octokit.rest.git.createBlob({ owner, repo, encoding: 'base64', content: gzip.toString('base64') }),
      ]);
      const tree = await this.octokit.rest.git.createTree({ owner, repo, base_tree: base.data.tree.sha, tree: [
        { path: 'catalog.json', mode: '100644', type: 'blob', sha: plainBlob.data.sha },
        { path: 'catalog.json.gz', mode: '100644', type: 'blob', sha: compressedBlob.data.sha },
      ] });
      const commit = await this.octokit.rest.git.createCommit({
        owner, repo, tree: tree.data.sha, parents: [parent],
        message: incoming.length ? `catalog: update ${incoming.length} materials` : 'catalog: compressed snapshot',
      });
      try {
        // A concurrent writer makes this update non-fast-forward. Never force it.
        await this.octokit.rest.git.updateRef({ owner, repo, ref, sha: commit.data.sha, force: false });
        return { catalog, compressedBytes: gzip.length };
      } catch (error: any) {
        if (error.status !== 409 && error.status !== 422) throw error;
        const latest = await this.octokit.rest.git.getRef({ owner, repo, ref });
        if (latest.data.object.sha === parent || attempt === 5) throw error;
        // Another process won: read its commit and merge again, preserving its work.
      }
    }
    throw new Error('Catalog update conflict');
  }

  async upsertMany(incoming: Material[]): Promise<Catalog> {
    return this.enqueue(async () => (await this.commit(incoming)).catalog);
  }

  async writeCompressed(_catalog?: Catalog) {
    // Re-read the current commit instead of publishing a possibly stale caller snapshot.
    return this.enqueue(async () => (await this.commit([])).compressedBytes);
  }
}
