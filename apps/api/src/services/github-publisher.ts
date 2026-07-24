import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { Octokit } from '@octokit/rest';
import { slugify, materialSchema, type MaterialKind, type Material } from '@csd/shared';
import { config } from '../config.js';
import { CatalogService } from './catalog.js';

export type PublishInput = {
  filePath: string; originalName: string; mimeType: string; sha256: string;
  title: string; description: string; course: string; subject: string;
  kind: MaterialKind; tags: string[]; source: 'admin' | 'telegram'; author?: string;
  sourcePath?: string;
};

export class GitHubPublisher {
  readonly octokit: Octokit;
  readonly catalog: CatalogService;
  private readonly releaseCache = new Map<string, Promise<{ id: number; assets: Map<string, string>; created: boolean }>>();

  constructor() {
    this.octokit = new Octokit({ auth: config.GITHUB_TOKEN });
    this.catalog = new CatalogService(this.octokit);
  }

  private repositoryFor(course: string) {
    return config.repoMap[course] || config.repoMap.default || 'csd-materials';
  }

  private async releaseFor(repo: string, course: string, hash: string) {
    const tag = `library-${slugify(course)}-${hash[0] || '0'}`;
    const key = `${repo}:${tag}`;
    const cached = this.releaseCache.get(key);
    if (cached) return cached;
    const loading = (async () => {
      let id: number; let created = false;
      try {
        const release = await this.octokit.rest.repos.getReleaseByTag({ owner: config.GITHUB_OWNER, repo, tag });
        id = release.data.id;
      } catch (error: any) {
        if (error.status !== 404) throw error;
        const release = await this.octokit.rest.repos.createRelease({
          owner: config.GITHUB_OWNER, repo, tag_name: tag,
          name: `${course} · пакет ${hash[0]?.toUpperCase() || '0'}`,
          body: 'Автоматически сформированный пакет материалов CSD Library. Не удаляйте assets вручную: они связаны с общим каталогом.',
        });
        id = release.data.id; created = true;
      }
      const assets = await this.octokit.paginate(this.octokit.rest.repos.listReleaseAssets, {
        owner: config.GITHUB_OWNER, repo, release_id: id, per_page: 100,
      });
      return { id, created, assets: new Map(assets.map((asset) => [asset.name, asset.browser_download_url])) };
    })();
    this.releaseCache.set(key, loading);
    try { return await loading; }
    catch (error) { this.releaseCache.delete(key); throw error; }
  }

  async publish(input: PublishInput, updateCatalog = true): Promise<Material> {
    if (!config.githubReady) throw new Error('GitHub credentials are not configured');
    const repo = this.repositoryFor(input.course);
    const id = `${slugify(input.course)}-${slugify(input.subject)}-${input.sha256.slice(0, 12)}`;
    const release = await this.releaseFor(repo, input.course, input.sha256);
    const fileStat = await stat(input.filePath);
    const assetName = `${input.sha256.slice(0, 12)}-${input.originalName}`;
    let downloadUrl = release.assets.get(assetName);
    if (!downloadUrl) {
      const uploadUrl = `https://uploads.github.com/repos/${encodeURIComponent(config.GITHUB_OWNER)}/${encodeURIComponent(repo)}/releases/${release.id}/assets?name=${encodeURIComponent(assetName)}`;
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': input.mimeType,
          'Content-Length': String(fileStat.size),
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: createReadStream(input.filePath) as any,
        duplex: 'half',
      } as RequestInit);
      if (!response.ok) {
        const body = await response.text();
        if (response.status === 422 && body.includes('already_exists')) {
          const assets = await this.octokit.paginate(this.octokit.rest.repos.listReleaseAssets, {
            owner: config.GITHUB_OWNER, repo, release_id: release.id, per_page: 100,
          });
          const existing = assets.find((asset) => asset.name.startsWith(input.sha256.slice(0, 12)));
          if (existing) {
            downloadUrl = existing.browser_download_url;
            release.assets.set(assetName, downloadUrl);
          } else throw new Error(`GitHub reported an existing asset but it could not be resolved: ${body}`);
        } else throw new Error(`GitHub upload failed: ${response.status} ${body}`);
      } else {
        const asset = await response.json() as { browser_download_url: string };
        downloadUrl = asset.browser_download_url;
        release.assets.set(assetName, downloadUrl);
      }
    }
    const now = new Date().toISOString();
    const material = materialSchema.parse({
      id, title: input.title, description: input.description, course: input.course,
      subject: input.subject, kind: input.kind, tags: input.tags,
      path: input.sourcePath || `/${input.course}/${input.subject}/${input.originalName}`,
      fileName: basename(input.originalName), mimeType: input.mimeType, size: fileStat.size,
      sha256: input.sha256, downloadUrl,
      previewUrl: downloadUrl, source: input.source, repository: repo,
      addedAt: now, updatedAt: now, author: input.author,
    });
    if (updateCatalog) await this.catalog.upsert(material);
    return material;
  }
}
