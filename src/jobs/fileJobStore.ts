import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PipelineJobResult, PipelineStepEvent } from "../pipeline/types.ts";
import type { CreateJobRecordInput, JobError, JobStatus, PipelineJobRecord } from "./types.ts";

export type FileJobStoreOptions = {
  rootDir: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

export class FileJobStore {
  readonly rootDir: string;

  constructor(options: FileJobStoreOptions) {
    this.rootDir = options.rootDir;
  }

  async create(input: CreateJobRecordInput): Promise<PipelineJobRecord> {
    const now = nowIso();
    const record: PipelineJobRecord = {
      id: input.id,
      status: "queued",
      createdAt: now,
      updatedAt: now,
      inputArtifact: input.inputArtifact,
      events: []
    };
    await this.write(record);
    return record;
  }

  async get(jobId: string): Promise<PipelineJobRecord | undefined> {
    try {
      const contents = await readFile(this.pathFor(jobId), "utf8");
      return JSON.parse(contents) as PipelineJobRecord;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async setStatus(jobId: string, status: JobStatus): Promise<PipelineJobRecord> {
    const record = await this.require(jobId);
    record.status = status;
    record.updatedAt = nowIso();
    await this.write(record);
    return record;
  }

  async appendEvent(jobId: string, event: PipelineStepEvent): Promise<PipelineJobRecord> {
    const record = await this.require(jobId);
    record.events.push(event);
    record.updatedAt = nowIso();
    await this.write(record);
    return record;
  }

  async complete(jobId: string, result: PipelineJobResult): Promise<PipelineJobRecord> {
    const record = await this.require(jobId);
    record.status = "succeeded";
    record.result = result;
    record.events = result.events;
    record.updatedAt = nowIso();
    await this.write(record);
    return record;
  }

  async fail(jobId: string, error: JobError): Promise<PipelineJobRecord> {
    const record = await this.require(jobId);
    record.status = "failed";
    record.error = error;
    record.updatedAt = nowIso();
    await this.write(record);
    return record;
  }

  private async require(jobId: string): Promise<PipelineJobRecord> {
    const record = await this.get(jobId);
    if (record === undefined) {
      throw new Error(`Job ${jobId} was not found.`);
    }
    return record;
  }

  private pathFor(jobId: string): string {
    return join(this.rootDir, `${jobId}.json`);
  }

  private async write(record: PipelineJobRecord): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    const targetPath = this.pathFor(record.id);
    const tempPath = join(this.rootDir, `${record.id}.${randomUUID()}.tmp`);

    await writeFile(tempPath, JSON.stringify(record, null, 2) + "\n");
    await rename(tempPath, targetPath);
  }
}
