import { catalogSchema, type Catalog } from '@csd/shared';
import bundledCatalog from '../../../../data/catalog.json';

export async function loadCatalog(): Promise<Catalog> {
  const url = import.meta.env.VITE_CATALOG_URL;
  if (!url) return catalogSchema.parse(bundledCatalog);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Каталог недоступен (${response.status})`);
  return catalogSchema.parse(await response.json());
}
