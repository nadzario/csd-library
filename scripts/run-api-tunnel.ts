import 'dotenv/config';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const execute = promisify(execFile);
const root = process.cwd();
const binary = join(root, 'bin', 'cloudflared');
const statePath = join(root, 'data', 'api-public-url.txt');
const repository = process.env.GITHUB_OWNER
  ? `${process.env.GITHUB_OWNER}/csd-library`
  : 'nadzario/csd-library';
let configuring: Promise<void> | undefined;
let stopping = false;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function publishUrl(url: string) {
  // Cloudflared prints the URL before its edge connection finishes registering.
  // A short delay avoids depending on the host DNS, which may be filtered by a VPN.
  await wait(10_000);
  let previous = '';
  try { previous = (await readFile(statePath, 'utf8')).trim(); } catch {
    // The state file is created after the first successful tunnel.
  }
  if (previous === url) return;
  await execute('gh', ['variable', 'set', 'API_PUBLIC_URL', '--repo', repository, '--body', url]);
  await execute('gh', ['workflow', 'run', 'pages.yml', '--repo', repository, '--ref', 'main']);
  await mkdir(join(root, 'data'), { recursive: true });
  await writeFile(statePath, `${url}\n`, { mode: 0o600 });
  console.log(`Public API ready: ${url}`);
  console.log('GitHub Pages rebuild requested.');
}

const tunnel = spawn(binary, [
  'tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', 'http://127.0.0.1:3000',
], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });

let output = '';
const onOutput = (chunk: Buffer) => {
  const text = chunk.toString();
  process.stdout.write(text);
  output = `${output}${text}`.slice(-20_000);
  const url = output.match(/https:\/\/(?!api\.)[a-z0-9]+(?:-[a-z0-9]+){2,}\.trycloudflare\.com/i)?.[0];
  if (url && !configuring) {
    configuring = publishUrl(url).catch((error) => {
      console.error('Could not publish tunnel URL:', error);
      tunnel.kill('SIGTERM');
      process.exitCode = 1;
    });
  }
};
tunnel.stdout.on('data', onOutput);
tunnel.stderr.on('data', onOutput);
tunnel.on('error', (error) => { console.error('Could not start cloudflared:', error); process.exitCode = 1; });
tunnel.on('exit', (code, signal) => {
  console.log(`cloudflared stopped (${signal || code || 0})`);
  process.exit(stopping ? 0 : code || 1);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    stopping = true;
    tunnel.kill(signal);
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}
