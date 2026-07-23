import { readFile } from 'node:fs/promises';

try {
  const state = JSON.parse(await readFile('data/import-state.json', 'utf8')) as Record<string, unknown>;
  console.table(state);
} catch {
  console.log('Migration has not started yet.');
}
