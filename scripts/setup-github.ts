import 'dotenv/config';
import { Octokit } from '@octokit/rest';
import { execFileSync } from 'node:child_process';

let token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (!token) {
  try { token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { /* A clear configuration error is thrown below. */ }
}
const owner = process.env.GITHUB_OWNER;
if (!token || !owner) throw new Error('Authenticate GitHub CLI or set GITHUB_TOKEN and GITHUB_OWNER first');
const map = JSON.parse(process.env.GITHUB_REPO_MAP || '{"default":"csd-materials"}') as Record<string, string>;
const catalogRepo = process.env.GITHUB_CATALOG_REPO || 'csd-catalog';
const repositories = [...new Set([catalogRepo, ...Object.values(map)])];
const octokit = new Octokit({ auth: token });
const user = await octokit.rest.users.getAuthenticated();

for (const repo of repositories) {
  try { await octokit.rest.repos.get({ owner, repo }); console.log(`exists: ${owner}/${repo}`); }
  catch (error: any) {
    if (error.status !== 404) throw error;
    if (user.data.login === owner) await octokit.rest.repos.createForAuthenticatedUser({ name: repo, description: 'CSD open student library', private: false, auto_init: true });
    else await octokit.rest.repos.createInOrg({ org: owner, name: repo, description: 'CSD open student library', private: false, auto_init: true });
    console.log(`created: ${owner}/${repo}`);
  }
}

try {
  await octokit.rest.repos.getContent({ owner, repo: catalogRepo, path: 'catalog.json' });
  console.log(`exists: ${owner}/${catalogRepo}/catalog.json`);
} catch (error: any) {
  if (error.status !== 404) throw error;
  const emptyCatalog = { version: 1, generatedAt: new Date().toISOString(), materials: [] };
  await octokit.rest.repos.createOrUpdateFileContents({
    owner, repo: catalogRepo, path: 'catalog.json', message: 'catalog: initialize',
    content: Buffer.from(JSON.stringify(emptyCatalog, null, 2)).toString('base64'),
  });
  console.log(`created: ${owner}/${catalogRepo}/catalog.json`);
}
