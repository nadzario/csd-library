import type { Material } from '@csd/shared';

const textExtensions = new Set([
  'txt', 'md', 'csv', 'json', 'xml', 'yaml', 'yml', 'html', 'htm', 'css',
  'js', 'ts', 'tsx', 'jsx', 'c', 'h', 'cpp', 'hpp', 'java', 'py', 'go',
  'rs', 'sql', 'sh', 'tex', 'log', 'ini', 'cfg',
]);
const officeExtensions = new Set(['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp']);

export function extensionOf(fileName: string) {
  const extension = fileName.split('.').pop();
  return extension && extension !== fileName ? extension.toLocaleLowerCase('ru') : '';
}

export function formatOf(material: Pick<Material, 'fileName' | 'mimeType'>) {
  const extension = extensionOf(material.fileName);
  if (extension) return extension.toUpperCase();
  const subtype = material.mimeType.split('/')[1]?.split(/[;+]/)[0];
  return subtype?.toUpperCase() || 'ФАЙЛ';
}

export type PreviewKind = 'image' | 'pdf' | 'text' | 'office' | 'unsupported';

export function previewKind(material: Material): PreviewKind {
  const extension = extensionOf(material.fileName);
  if (material.mimeType.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff'].includes(extension)) return 'image';
  if (material.mimeType.includes('pdf') || extension === 'pdf') return 'pdf';
  if (material.mimeType.startsWith('text/') || textExtensions.has(extension)) return 'text';
  if (officeExtensions.has(extension)) return 'office';
  return 'unsupported';
}

export function pathParts(path: string) {
  return path.split('/').filter(Boolean);
}

export function externalDocumentUrl(downloadUrl: string) {
  const viewer = new URL('https://docs.google.com/viewer');
  viewer.searchParams.set('url', downloadUrl);
  return viewer.toString();
}
