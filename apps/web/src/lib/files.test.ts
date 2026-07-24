import { describe, expect, it } from 'vitest';
import type { Material } from '@csd/shared';
import { extensionOf, formatOf, pathParts, previewKind } from './files';

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
});
