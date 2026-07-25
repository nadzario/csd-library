import { describe, expect, it } from 'vitest';
import { buildMaterialPath, folderOf, normalizeFolderPath } from '../src/lib/material-path.js';

describe('material catalog paths', () => {
  it('supports deeply nested folders and normalizes separators', () => {
    expect(buildMaterialPath(
      '1 курс\\Кафедра / Алгебра / Лекции / 2026',
      '../конспект.pdf',
      '1 курс',
      'Алгебра',
    )).toBe('/1 курс/Кафедра/Алгебра/Лекции/2026/конспект.pdf');
  });

  it('uses course and subject when the folder is empty', () => {
    expect(normalizeFolderPath('', '2 курс', 'Физика')).toBe('/2 курс/Физика');
  });

  it('rejects parent traversal and extracts an existing folder', () => {
    expect(() => normalizeFolderPath('1 курс/../секрет', '1', 'Предмет')).toThrow('Некорректный путь');
    expect(folderOf('/1 курс/Алгебра/Лекции/файл.pdf', 'файл.pdf')).toBe('/1 курс/Алгебра/Лекции');
  });
});
