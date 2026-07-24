import { catalogSchema, type Catalog } from '@csd/shared';
import bundledCatalog from '../../../../data/catalog.json';

export async function loadCatalog(): Promise<Catalog> {
  const url = import.meta.env.VITE_CATALOG_URL;
  if (!url) return catalogSchema.parse(bundledCatalog);
  if (url.endsWith('catalog.json') && typeof DecompressionStream !== 'undefined') {
    try {
      const compressed = await fetch(url.replace(/catalog\.json$/, 'catalog.json.gz'));
      if (compressed.ok && compressed.body) {
        const stream = compressed.body.pipeThrough(new DecompressionStream('gzip'));
        return catalogSchema.parse(await new Response(stream).json());
      }
    } catch {
      // Older browsers and temporarily unavailable snapshots use the JSON fallback.
    }
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Каталог недоступен (${response.status})`);
  return catalogSchema.parse(await response.json());
}
