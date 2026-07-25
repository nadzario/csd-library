import { basename } from 'node:path';

export function normalizeFolderPath(value: string | undefined, course: string, subject: string) {
  const source = String(value || '').trim() || `${course}/${subject}`;
  const parts = source
    .replaceAll('\\', '/')
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length || parts.some((part) => part === '.' || part === '..' || part.includes('\0'))) {
    throw new Error('Некорректный путь папки');
  }
  return `/${parts.join('/')}`;
}

export function buildMaterialPath(
  folderPath: string | undefined,
  fileName: string,
  course: string,
  subject: string,
) {
  const safeName = basename(fileName.replaceAll('\\', '/')).trim();
  if (!safeName || safeName === '.' || safeName === '..') throw new Error('Некорректное имя файла');
  return `${normalizeFolderPath(folderPath, course, subject)}/${safeName}`;
}

export function folderOf(path: string, fileName: string) {
  const normalized = path.replaceAll('\\', '/');
  const suffix = `/${fileName}`;
  if (normalized.endsWith(suffix)) return normalized.slice(0, -suffix.length) || '/';
  const index = normalized.lastIndexOf('/');
  return index > 0 ? normalized.slice(0, index) : '/';
}
