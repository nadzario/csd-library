import { z } from 'zod';

export const materialKindSchema = z.enum([
  'lecture', 'seminar', 'exam', 'book', 'guide', 'homework', 'other',
]);

export const materialSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  course: z.string().min(1),
  subject: z.string().default('Без предмета'),
  kind: materialKindSchema.default('other'),
  tags: z.array(z.string()).default([]),
  path: z.string().min(1),
  fileName: z.string().min(1),
  mimeType: z.string().default('application/octet-stream'),
  size: z.number().int().nonnegative(),
  sha256: z.string().default(''),
  downloadUrl: z.string().url(),
  previewUrl: z.string().url().optional(),
  source: z.enum(['yandex', 'admin', 'telegram']),
  repository: z.string().optional(),
  addedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  author: z.string().optional(),
});

export const catalogSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string().datetime(),
  materials: z.array(materialSchema),
});

export type Material = z.infer<typeof materialSchema>;
export type Catalog = z.infer<typeof catalogSchema>;
export type MaterialKind = z.infer<typeof materialKindSchema>;

export const emptyCatalog = (): Catalog => ({
  version: 1,
  generatedAt: new Date().toISOString(),
  materials: [],
});

export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '') || 'material';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (let i = 1; value >= 1024 && i < units.length; i += 1) {
    value /= 1024;
    unit = units[i]!;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${unit}`;
}
