import 'dotenv/config';
import { GitHubPublisher } from '../apps/api/src/services/github-publisher.js';

const publisher = new GitHubPublisher();
const catalog = await publisher.catalog.read();
const bytes = await publisher.catalog.writeCompressed(catalog);
console.log(`Published catalog.json.gz: ${catalog.materials.length} materials, ${(bytes / 1024 / 1024).toFixed(2)} MiB`);
