import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FileJobStore } from "../jobs/fileJobStore.ts";
import { PipelineJobRunner } from "../jobs/pipelineJobRunner.ts";
import type { PipelineJobRecord } from "../jobs/types.ts";
import type { PipelineProviders } from "../pipeline/types.ts";
import { labelForManualInstrumentSelection } from "../pipeline/naming.ts";
import { FileArtifactStore } from "../storage/fileArtifactStore.ts";

export type JobServerOptions = {
  rootDir: string;
  providers?: PipelineProviders | ((context: { artifactStore: FileArtifactStore }) => PipelineProviders);
  maxUploadBytes?: number;
};

export type JobServerApp = {
  api: JobApi;
  artifactStore: FileArtifactStore;
  jobStore: FileJobStore;
  runner: PipelineJobRunner;
  server: Server;
};

export type CreateJobUploadInput = {
  bytes: Buffer;
  contentType: string;
  filename: string;
};

const defaultMaxUploadBytes = 500 * 1024 * 1024;

class HttpError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

function sendAudio(response: ServerResponse, body: Buffer, filename: string): void {
  response.writeHead(200, {
    "content-type": "audio/wav",
    "content-length": body.length,
    "content-disposition": `inline; filename="${filename.replace(/"/g, "")}"`
  });
  response.end(body);
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function filenameFromRequest(request: IncomingMessage): string {
  const explicitFilename = singleHeader(request.headers["x-filename"]);
  if (explicitFilename !== undefined && explicitFilename.trim().length > 0) {
    return explicitFilename;
  }

  const contentDisposition = singleHeader(request.headers["content-disposition"]);
  const dispositionFilename = contentDisposition?.match(/filename="?([^";]+)"?/i)?.[1];
  return dispositionFilename ?? "input.wav";
}

function assertUploadContentTypeValue(contentType: string): void {
  const normalized = contentType.toLowerCase();

  if (
    normalized.includes("audio/wav") ||
    normalized.includes("audio/x-wav") ||
    normalized.includes("application/octet-stream")
  ) {
    return;
  }

  throw new HttpError(415, "Upload must use audio/wav, audio/x-wav, or application/octet-stream content type.");
}

function requestContentType(request: IncomingMessage): string {
  return singleHeader(request.headers["content-type"]) ?? "";
}

async function readBody(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;

    if (total > maxBytes) {
      throw new HttpError(413, `Upload exceeds ${maxBytes} byte limit.`);
    }

    chunks.push(buffer);
  }

  if (total === 0) {
    throw new HttpError(400, "Upload body is empty.");
  }

  return Buffer.concat(chunks, total);
}

async function readJsonBody(request: IncomingMessage, maxBytes: number): Promise<unknown> {
  const body = await readBody(request, maxBytes);
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

function createJobId(): string {
  return `job_${Date.now()}_${randomUUID().slice(0, 8)}`;
}

function routeJobId(pathname: string, suffix = ""): string | undefined {
  const pattern = new RegExp(`^/v1/jobs/([^/]+)${suffix}$`);
  return pathname.match(pattern)?.[1];
}

function routeReviewRequests(pathname: string): string | undefined {
  return pathname.match(/^\/v1\/jobs\/([^/]+)\/review-requests$/)?.[1];
}

function routeReviewRequest(pathname: string, suffix = ""): { jobId: string; reviewRequestId: string } | undefined {
  const pattern = new RegExp(`^/v1/jobs/([^/]+)/review-requests/([^/]+)${suffix}$`);
  const match = pathname.match(pattern);
  return match === null ? undefined : { jobId: match[1] ?? "", reviewRequestId: match[2] ?? "" };
}

function selectionFromBody(body: unknown): string {
  if (typeof body === "string" && body.trim().length > 0) {
    return body;
  }

  if (body !== null && typeof body === "object" && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    const value = record.instrument ?? record.canonicalName ?? record.selection;
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  throw new HttpError(400, "Manual review body must include an instrument selection.");
}

function publicReviewRequests(record: PipelineJobRecord): unknown[] {
  return (
    record.pendingInstrumentReview?.requests.map((request) => ({
      ...request,
      clipUrl: `/v1/jobs/${record.id}/review-requests/${request.id}/clip`
    })) ?? []
  );
}

function jobSummary(record: PipelineJobRecord): unknown {
  return {
    id: record.id,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    inputArtifact: record.inputArtifact,
    events: record.events,
    pendingInstrumentReviews: publicReviewRequests(record),
    result: record.result,
    error: record.error
  };
}

export class JobApi {
  private readonly artifactStore: FileArtifactStore;
  private readonly jobStore: FileJobStore;
  private readonly runner: PipelineJobRunner;
  private readonly maxUploadBytes: number;

  constructor(
    artifactStore: FileArtifactStore,
    jobStore: FileJobStore,
    runner: PipelineJobRunner,
    maxUploadBytes: number
  ) {
    this.artifactStore = artifactStore;
    this.jobStore = jobStore;
    this.runner = runner;
    this.maxUploadBytes = maxUploadBytes;
  }

  async createJobFromUpload(input: CreateJobUploadInput): Promise<unknown> {
    assertUploadContentTypeValue(input.contentType);

    if (input.bytes.length === 0) {
      throw new HttpError(400, "Upload body is empty.");
    }

    if (input.bytes.length > this.maxUploadBytes) {
      throw new HttpError(413, `Upload exceeds ${this.maxUploadBytes} byte limit.`);
    }

    const jobId = createJobId();
    const stored = await this.artifactStore.saveInputWav(jobId, input.filename, input.bytes);
    const record = await this.jobStore.create({ id: jobId, inputArtifact: stored.artifact });
    this.runner.start(record);

    return {
      jobId,
      status: record.status,
      statusUrl: `/v1/jobs/${jobId}`,
      resultUrl: `/v1/jobs/${jobId}/result`,
      inputArtifact: stored.artifact
    };
  }

  async getJobStatus(jobId: string): Promise<unknown> {
    const record = await this.jobStore.get(jobId);
    if (record === undefined) {
      throw new HttpError(404, `Job ${jobId} was not found.`);
    }

    return jobSummary(record);
  }

  async getJobResult(jobId: string): Promise<unknown> {
    const record = await this.jobStore.get(jobId);
    if (record === undefined) {
      throw new HttpError(404, `Job ${jobId} was not found.`);
    }

    if (record.status !== "succeeded" || record.result === undefined) {
      throw new HttpError(409, `Job ${jobId} is ${record.status}; result is not ready.`);
    }

    return record.result;
  }

  async getInstrumentReviewRequests(jobId: string): Promise<unknown> {
    const record = await this.jobStore.get(jobId);
    if (record === undefined) {
      throw new HttpError(404, `Job ${jobId} was not found.`);
    }

    return {
      jobId,
      status: record.status,
      requests: publicReviewRequests(record)
    };
  }

  async getInstrumentReviewClip(jobId: string, reviewRequestId: string): Promise<{ bytes: Buffer; filename: string }> {
    const record = await this.jobStore.get(jobId);
    if (record === undefined) {
      throw new HttpError(404, `Job ${jobId} was not found.`);
    }

    const request = record.pendingInstrumentReview?.requests.find((item) => item.id === reviewRequestId);
    if (request === undefined) {
      throw new HttpError(404, `Review request ${reviewRequestId} was not found.`);
    }

    return {
      bytes: await readFile(fileURLToPath(request.clip.uri)),
      filename: request.clip.filename
    };
  }

  async submitInstrumentReview(jobId: string, reviewRequestId: string, selection: string): Promise<unknown> {
    const record = await this.jobStore.get(jobId);
    if (record === undefined) {
      throw new HttpError(404, `Job ${jobId} was not found.`);
    }

    const pending = record.pendingInstrumentReview;
    if (record.status !== "awaiting-review" || pending === undefined) {
      throw new HttpError(409, `Job ${jobId} is ${record.status}; no manual review is pending.`);
    }

    const requestIndex = pending.requests.findIndex((request) => request.id === reviewRequestId);
    if (requestIndex === -1) {
      throw new HttpError(404, `Review request ${reviewRequestId} was not found.`);
    }

    const request = pending.requests[requestIndex];
    if (request === undefined) {
      throw new HttpError(404, `Review request ${reviewRequestId} was not found.`);
    }

    const selectedLabel = labelForManualInstrumentSelection(selection, request.stemArtifactId);
    const requests = pending.requests.map((item, index) =>
      index === requestIndex
        ? {
            ...item,
            status: "resolved" as const,
            selectedLabel
          }
        : item
    );
    const instrumentStems = pending.state.instrumentStems.map((stem) =>
      stem.stem.id === request.stemArtifactId
        ? {
            ...stem,
            label: selectedLabel
          }
        : stem
    );
    const updatedPending = {
      state: {
        ...pending.state,
        instrumentStems
      },
      requests
    };
    const allResolved = requests.every((item) => item.status === "resolved");
    const updatedRecord = await this.jobStore.updatePendingInstrumentReview(
      jobId,
      updatedPending,
      allResolved ? "running" : "awaiting-review"
    );

    if (allResolved) {
      this.runner.startResume(updatedRecord);
    }

    return {
      jobId,
      status: allResolved ? "running" : "awaiting-review",
      requests: publicReviewRequests(updatedRecord)
    };
  }
}

export function createJobServer(options: JobServerOptions): JobServerApp {
  const artifactStore = new FileArtifactStore({ rootDir: join(options.rootDir, "artifacts") });
  const jobStore = new FileJobStore({ rootDir: join(options.rootDir, "jobs") });
  const providers = typeof options.providers === "function" ? options.providers({ artifactStore }) : options.providers;
  const runner = new PipelineJobRunner(jobStore, artifactStore, providers);
  const maxUploadBytes = options.maxUploadBytes ?? defaultMaxUploadBytes;
  const api = new JobApi(artifactStore, jobStore, runner, maxUploadBytes);

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "POST" && url.pathname === "/v1/jobs") {
        const contentType = requestContentType(request);
        assertUploadContentTypeValue(contentType);
        const bytes = await readBody(request, maxUploadBytes);
        const created = await api.createJobFromUpload({
          bytes,
          contentType,
          filename: filenameFromRequest(request)
        });
        sendJson(response, 202, created);
        return;
      }

      const resultJobId = request.method === "GET" ? routeJobId(url.pathname, "/result") : undefined;
      if (resultJobId !== undefined) {
        sendJson(response, 200, await api.getJobResult(resultJobId));
        return;
      }

      const reviewClipRoute = request.method === "GET" ? routeReviewRequest(url.pathname, "/clip") : undefined;
      if (reviewClipRoute !== undefined) {
        const clip = await api.getInstrumentReviewClip(reviewClipRoute.jobId, reviewClipRoute.reviewRequestId);
        sendAudio(response, clip.bytes, clip.filename);
        return;
      }

      const reviewRequestsJobId = request.method === "GET" ? routeReviewRequests(url.pathname) : undefined;
      if (reviewRequestsJobId !== undefined) {
        sendJson(response, 200, await api.getInstrumentReviewRequests(reviewRequestsJobId));
        return;
      }

      const reviewRequestRoute = request.method === "POST" ? routeReviewRequest(url.pathname) : undefined;
      if (reviewRequestRoute !== undefined) {
        const body = await readJsonBody(request, maxUploadBytes);
        sendJson(
          response,
          202,
          await api.submitInstrumentReview(
            reviewRequestRoute.jobId,
            reviewRequestRoute.reviewRequestId,
            selectionFromBody(body)
          )
        );
        return;
      }

      const statusJobId = request.method === "GET" ? routeJobId(url.pathname) : undefined;
      if (statusJobId !== undefined) {
        sendJson(response, 200, await api.getJobStatus(statusJobId));
        return;
      }

      throw new HttpError(404, "Route not found.");
    } catch (error: unknown) {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, statusCode, { error: { message } });
    }
  });

  return {
    api,
    artifactStore,
    jobStore,
    runner,
    server
  };
}
