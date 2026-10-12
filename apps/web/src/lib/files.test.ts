import { describe, expect, it } from 'vitest';
import type { Material } from '@csd/shared';
import { extensionOf, externalDocumentUrl, formatOf, pathParts, previewKind } from './files';

const material = (fileName: string, mimeType = 'application/octet-stream') => ({
  fileName, mimeType,
} as Material);

describe('file presentation', () => {
  it('shows explicit formats', () => {
    expect(extensionOf('Конспект.PDF')).toBe('pdf');
    expect(formatOf(material('таблица.xlsx'))).toBe('XLSX');
  });

  it('selects safe preview renderers', () => {
    expect(previewKind(material('photo.jpg', 'image/jpeg'))).toBe('image');
    expect(previewKind(material('notes.txt'))).toBe('text');
    expect(previewKind(material('report.docx'))).toBe('office');
    expect(previewKind(material('archive.zip'))).toBe('unsupported');
  });

  it('preserves nested folder paths', () => {
    expect(pathParts('/3 курс/Кафедра/Предмет/Лекции/01.pdf')).toEqual([
      '3 курс', 'Кафедра', 'Предмет', 'Лекции', '01.pdf',
    ]);
  });

  it('does not select active previews from a disguised filename or MIME', () => {
    expect(previewKind(material('evil.pdf', 'text/html'))).toBe('text');
    expect(previewKind(material('evil.pdf', 'application/octet-stream'))).toBe('unsupported');
    expect(previewKind(material('evil.jpg', 'text/html'))).toBe('text');
    expect(previewKind(material('evil.svg', 'image/svg+xml'))).toBe('unsupported');
    expect(previewKind(material('report.pdf', 'application/pdf'))).toBe('pdf');
  });

  it('opens Google document previews outside an iframe', () => {
    const source = 'https://example.com/Конспект 1.pdf';
    const viewer = new URL(externalDocumentUrl(source));

    expect(viewer.origin + viewer.pathname).toBe('https://docs.google.com/viewer');
    expect(viewer.searchParams.get('url')).toBe(source);
    expect(viewer.searchParams.has('embedded')).toBe(false);
  });
});
