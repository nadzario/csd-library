import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import type { Octokit } from '@octokit/rest';
import { emptyCatalog, type Catalog, type Material } from '@csd/shared';
import { CatalogService } from '../src/services/catalog.js';
import { config } from '../src/config.js';

const ready = config.githubReady;
afterEach(() => { config.githubReady = ready; });
const material = (id: string) => ({ id, title: id, course: '1 курс', subject: 'Матан', path: `/1 курс/Матан/${id}.pdf`, fileName: `${id}.pdf`, downloadUrl: 'https://github.com/nadzario/csd-early/releases/download/library/a.pdf', source: 'admin', size: 1, addedAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as Material);

function remote() {
  let next = 0;
  let head = 'initial';
  const blobs = new Map<string, Buffer>();
  const trees = new Map<string, Record<string, string>>();
  const commits = new Map<string, { parent: string; tree: string }>();
  let initial: Catalog = emptyCatalog();
  const snapshots: Catalog[] = [];
  const api = { rest: {
    repos: { getContent: async ({ ref }: { ref: string }) => {
      if (ref === 'initial') return { data: { content: Buffer.from(JSON.stringify(initial)).toString('base64') } };
      const tree = trees.get(commits.get(ref)!.tree)!;
      return { data: { content: blobs.get(tree['catalog.json']!)!.toString('base64') } };
    } },
    git: {
      getRef: async () => ({ data: { object: { sha: head } } }),
      getCommit: async () => ({ data: { tree: { sha: 'base-tree' } } }),
      createBlob: async ({ content }: { content: string }) => { const sha = `blob-${next++}`; blobs.set(sha, Buffer.from(content, 'base64')); return { data: { sha } }; },
      createTree: async ({ tree }: { tree: { path: string; sha: string }[] }) => { const sha = `tree-${next++}`; trees.set(sha, Object.fromEntries(tree.map((entry) => [entry.path, entry.sha]))); return { data: { sha } }; },
      createCommit: async ({ parents, tree }: { parents: string[]; tree: string }) => { const sha = `commit-${next++}`; commits.set(sha, { parent: parents[0]!, tree }); return { data: { sha } }; },
      updateRef: async ({ sha, force }: { sha: string; force: boolean }) => {
        expect(force).toBe(false);
        const commit = commits.get(sha)!;
        if (commit.parent !== head) throw Object.assign(new Error('Not a fast forward'), { status: 422 });
        const tree = trees.get(commit.tree)!;
        const json = JSON.parse(blobs.get(tree['catalog.json']!)!.toString());
        expect(JSON.parse(gunzipSync(blobs.get(tree['catalog.json.gz']!)!).toString())).toEqual(json);
        head = sha; snapshots.push(json);
        return { data: {} };
      },
    },
  } };
  return { api: api as unknown as Octokit, snapshots, setInitial: (value: Catalog) => { initial = value; } };
}

describe('atomic catalog updates', () => {
  it('preserves concurrent updates from different processes and commits matching gzip', async () => {
    config.githubReady = true;
    const git = remote();
    const first = new CatalogService(git.api); const second = new CatalogService(git.api);
    await Promise.all([first.upsert(material('a')), second.upsert(material('b'))]);
    expect(git.snapshots.at(-1)!.materials.map((item) => item.id).sort()).toEqual(['a', 'b']);
  });

  it('serializes updates and compression does not overwrite a newer catalog with a stale snapshot', async () => {
    config.githubReady = true;
    const git = remote(); const service = new CatalogService(git.api);
    await Promise.all([service.upsert(material('a')), service.upsert(material('b'))]);
    await service.writeCompressed(emptyCatalog());
    expect(git.snapshots.at(-1)!.materials.map((item) => item.id).sort()).toEqual(['a', 'b']);
  });
});
