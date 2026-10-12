import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { config } from '../config.js';
import { basename, join } from 'node:path';
import {
  submissionSchema, submissionUpdateSchema,
  type Submission, type SubmissionUpdate,
} from '@csd/shared';

export type NewSubmission = Omit<Submission, 'id' | 'createdAt' | 'updatedAt'>;

export class SubmissionService {
  private mutation = Promise.resolve();
  private readonly filesRoot: string;
  private readonly indexPath: string;
  private readonly uploads = new Set<symbol>();

  constructor(root = join(process.cwd(), 'data', 'submissions')) {
    this.filesRoot = join(root, 'files');
    this.indexPath = join(root, 'index.json');
  }

  private async ensure() {
    await mkdir(this.filesRoot, { recursive: true });
  }

  private async readIndex(): Promise<Submission[]> {
    await this.ensure();
    try {
      const value = JSON.parse(await readFile(this.indexPath, 'utf8'));
      return submissionSchema.array().parse(value);
    } catch (error: any) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  private async writeIndex(submissions: Submission[]) {
    const temporary = `${this.indexPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(submissions, null, 2), { mode: 0o600 });
      await rename(temporary, this.indexPath);
    } finally { await rm(temporary, { force: true }); }
  }

  private async mutate<T>(operation: (submissions: Submission[]) => Promise<T>) {
    const previous = this.mutation;
    let release!: () => void;
    this.mutation = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation(await this.readIndex());
    } finally {
      release();
    }
  }

  filePath(id: string) {
    return join(this.filesRoot, basename(id));
  }

  async list() {
    return (await this.readIndex()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async find(id: string) {
    return (await this.readIndex()).find((submission) => submission.id === id);
  }

  async reserveUpload() {
    return this.mutate(async (submissions) => {
      if (this.uploads.size >= config.PUBLIC_UPLOAD_CONCURRENCY) {
        throw Object.assign(new Error('Слишком много одновременных загрузок. Попробуйте позже.'), { statusCode: 503 });
      }
      const bytes = submissions.reduce((sum, item) => sum + item.size, 0);
      if (submissions.length + this.uploads.size >= config.PUBLIC_QUEUE_MAX_FILES
        || bytes + (this.uploads.size + 1) * config.PUBLIC_SUBMISSION_MAX_MB * 1024 ** 2 > config.PUBLIC_QUEUE_MAX_MB * 1024 ** 2) {
        throw Object.assign(new Error('Очередь модерации заполнена. Попробуйте позже.'), { statusCode: 503 });
      }
      const reservation = Symbol();
      this.uploads.add(reservation);
      return () => { this.uploads.delete(reservation); };
    });
  }

  async create(input: NewSubmission, temporaryFile: string) {
    return this.mutate(async (submissions) => {
      const now = new Date().toISOString();
      const submission = submissionSchema.parse({ ...input, id: randomUUID(), createdAt: now, updatedAt: now });
      const destination = this.filePath(submission.id);
      try { await rename(temporaryFile, destination); }
      catch (error: any) {
        if (error.code !== 'EXDEV') throw error;
        // Compose mounts tmp and the queue separately: rename cannot cross mounts.
        const partial = `${destination}.partial`;
        try {
          await copyFile(temporaryFile, partial, constants.COPYFILE_EXCL);
          await rename(partial, destination);
          await rm(temporaryFile);
        } catch (copyError) {
          await rm(partial, { force: true });
          await rm(destination, { force: true });
          throw copyError;
        }
      }
      try {
        await this.writeIndex([...submissions, submission]);
      } catch (error) {
        await rm(this.filePath(submission.id), { force: true });
        throw error;
      }
      return submission;
    });
  }

  async update(id: string, value: SubmissionUpdate) {
    const update = submissionUpdateSchema.parse(value);
    return this.mutate(async (submissions) => {
      const index = submissions.findIndex((submission) => submission.id === id);
      if (index < 0) return undefined;
      const next = submissionSchema.parse({ ...submissions[index], ...update, id, updatedAt: new Date().toISOString() });
      submissions[index] = next;
      await this.writeIndex(submissions);
      return next;
    });
  }

  async remove(id: string) {
    return this.mutate(async (submissions) => {
      const found = submissions.find((submission) => submission.id === id);
      if (!found) return undefined;
      await this.writeIndex(submissions.filter((submission) => submission.id !== id));
      await rm(this.filePath(id), { force: true });
      return found;
    });
  }

  stream(id: string) {
    return createReadStream(this.filePath(id));
  }
}
