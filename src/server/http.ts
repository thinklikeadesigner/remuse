import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FileJobStore } from "../jobs/fileJobStore.ts";
import { PipelineJobRunner } from "../jobs/pipelineJobRunner.ts";
import type { PipelineJobRecord } from "../jobs/types.ts";
import type { PipelineProviders, PipelineStepName } from "../pipeline/types.ts";
import { labelForManualInstrumentSelection } from "../pipeline/naming.ts";
import { FileArtifactStore } from "../storage/fileArtifactStore.ts";

export type JobServerOptions = {
  rootDir: string;
  providers?: PipelineProviders | ((context: { artifactStore: FileArtifactStore }) => PipelineProviders);
  maxUploadBytes?: number;
  publicBaseUrl?: string;
  autoOpenReview?: boolean;
  openUrl?: (url: string) => void | Promise<void>;
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

type JobApiOptions = {
  publicBaseUrl: string;
  autoOpenReview: boolean;
  openUrl: (url: string) => void | Promise<void>;
};

const defaultMaxUploadBytes = 500 * 1024 * 1024;
const defaultPublicBaseUrl = "http://localhost:3000";
const progressSteps: readonly PipelineStepName[] = [
  "validate-input",
  "de-reverb",
  "instrument-stem-separation",
  "instrument-label-normalization",
  "manual-instrument-review",
  "midi-conversion",
  "opendaw-session-create",
  "opendaw-midi-import",
  "opendaw-bounce"
];

export function openUrlWithDefaultBrowser(url: string): Promise<void> {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args =
    process.platform === "darwin"
      ? [url]
      : process.platform === "win32"
        ? ["/c", "start", "", url]
        : [url];

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });

    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

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

function sendHtml(response: ServerResponse, statusCode: number, body: string): void {
  response.writeHead(statusCode, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(303, {
    location
  });
  response.end();
}

function sendAudio(response: ServerResponse, body: Buffer, filename: string): void {
  response.writeHead(200, {
    "content-type": "audio/wav",
    "content-length": body.length,
    "content-disposition": `inline; filename="${filename.replace(/"/g, "")}"`
  });
  response.end(body);
}

async function readDemoPage(): Promise<string> {
  return readFile(join(process.cwd(), "src", "demo", "demo.html"), "utf8");
}

function isDemoPageRoute(pathname: string): boolean {
  return pathname === "/" || pathname === "/demo" || pathname === "/demo.html";
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

async function readFormBody(request: IncomingMessage, maxBytes: number): Promise<URLSearchParams> {
  const body = await readBody(request, maxBytes);
  return new URLSearchParams(body.toString("utf8"));
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

function routeDiagnosticTrackBounces(pathname: string): string | undefined {
  return pathname.match(/^\/v1\/jobs\/([^/]+)\/diagnostic-track-bounces$/)?.[1];
}

function routeDiagnosticTrackBounce(pathname: string): { jobId: string; diagnosticBounceId: string } | undefined {
  const match = pathname.match(/^\/v1\/jobs\/([^/]+)\/diagnostic-track-bounces\/([^/]+)$/);
  return match === null ? undefined : { jobId: match[1] ?? "", diagnosticBounceId: decodeURIComponent(match[2] ?? "") };
}

function routeReviewPage(pathname: string): string | undefined {
  return pathname.match(/^\/review\/([^/]+)$/)?.[1];
}

function routeReviewForm(pathname: string): { jobId: string; reviewRequestId: string } | undefined {
  const match = pathname.match(/^\/review\/([^/]+)\/([^/]+)$/);
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

type ReviewFormAction = { kind: "label"; selection: string } | { kind: "discard" };

function reviewActionFromFormBody(body: URLSearchParams): ReviewFormAction {
  if (body.get("action") === "discard") {
    return { kind: "discard" };
  }

  const value = body.get("instrument") ?? body.get("selection") ?? body.get("canonicalName");
  if (value !== null && value.trim().length > 0) {
    return { kind: "label", selection: value };
  }

  throw new HttpError(400, "Manual review form must include an instrument selection.");
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function lastEvents(record: PipelineJobRecord): string {
  return record.events
    .slice(-12)
    .map(
      (event) =>
        `<li><code>${escapeHtml(event.at)}</code> ${escapeHtml(event.step)}: <strong>${escapeHtml(event.status)}</strong> ${escapeHtml(event.message)}</li>`
    )
    .join("");
}

function displayStepName(step: PipelineStepName): string {
  return step
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function progressForRecord(record: PipelineJobRecord): { percent: number; step: string; message: string } {
  if (record.status === "succeeded") {
    return { percent: 100, step: "Complete", message: "The ReMuse job has completed." };
  }

  const latestByStep = new Map<PipelineStepName, PipelineJobRecord["events"][number]>();
  for (const event of record.events) {
    latestByStep.set(event.step, event);
  }

  const completedSteps = progressSteps.filter((step) => {
    const status = latestByStep.get(step)?.status;
    return status === "succeeded" || status === "skipped";
  }).length;
  const latestEvent = record.events.at(-1);
  let units = completedSteps;

  if (record.status === "queued") {
    units = Math.max(units, 0.1);
  }

  if (latestEvent !== undefined) {
    const latestStepIndex = progressSteps.indexOf(latestEvent.step);
    if (latestStepIndex >= 0 && (latestEvent.status === "running" || latestEvent.status === "awaiting-input")) {
      units = Math.max(units, latestStepIndex + (latestEvent.status === "awaiting-input" ? 0.65 : 0.4));
    }
  }

  const percent = Math.max(2, Math.min(100, Math.round((units / progressSteps.length) * 100)));
  const fallbackStep: PipelineStepName = "validate-input";
  const currentStep = latestEvent?.step ?? fallbackStep;
  const message =
    latestEvent?.message ??
    (record.status === "queued" ? "Waiting for the job runner to start." : `Job is ${record.status}.`);

  return {
    percent,
    step: displayStepName(currentStep),
    message
  };
}

function renderProgressPanel(record: PipelineJobRecord): string {
  const progress = progressForRecord(record);
  return `
    <section class="progress-dialog" role="status" aria-live="polite" aria-label="ReMuse job status">
      <div class="progress-heading">
        <h2>ReMuse Status</h2>
        <span>${progress.percent}%</span>
      </div>
      <progress max="100" value="${progress.percent}">${progress.percent}%</progress>
      <p><strong>${escapeHtml(progress.step)}</strong></p>
      <p>${escapeHtml(progress.message)}</p>
    </section>
  `;
}

function renderReviewPage(record: PipelineJobRecord): string {
  const requests = record.pendingInstrumentReview?.requests ?? [];
  const shouldRefresh = record.status === "queued" || record.status === "running";
  const progressPanel =
    record.status === "queued" || record.status === "running" || record.status === "awaiting-review"
      ? renderProgressPanel(record)
      : "";
  const requestCards =
    requests.length === 0
      ? `<section class="empty"><p>No pending review clips.</p></section>`
      : requests
          .map((request, index) => {
            const clipUrl = `/v1/jobs/${encodeURIComponent(record.id)}/review-requests/${encodeURIComponent(request.id)}/clip`;
            const action = `/review/${encodeURIComponent(record.id)}/${encodeURIComponent(request.id)}`;
            const isResolved = request.status === "resolved";
            const isDiscarded = request.status === "discarded";
            const isComplete = isResolved || isDiscarded;
            const options = request.options
              .map((option) => {
                const selected =
                  request.selectedLabel?.canonicalName === option.canonicalName ||
                  request.selectedLabel?.canonicalName === option.displayName;
                return `<option value="${escapeHtml(option.displayName)}"${selected ? " selected" : ""}>${escapeHtml(option.displayName)}</option>`;
              })
              .join("");
            const control = isResolved
              ? `<p class="resolved-label">Selected: <strong>${escapeHtml(request.selectedLabel?.canonicalName ?? "resolved")}</strong></p>`
              : isDiscarded
                ? `<p class="resolved-label">Discarded from workflow.</p>`
                : `<div class="review-actions">
                    <form method="post" action="${action}">
                      <label>
                        Instrument
                        <select name="instrument">${options}</select>
                      </label>
                      <button type="submit">Submit</button>
                    </form>
                    <form method="post" action="${action}">
                      <input type="hidden" name="action" value="discard">
                      <button class="discard-button" type="submit">Discard</button>
                    </form>
                  </div>`;

            return `
              <section class="review-card${isComplete ? " is-resolved" : ""}">
                <div>
                  <p class="eyebrow">Review ${index + 1} of ${requests.length}</p>
                  <h2>${escapeHtml(request.stemFilename)}</h2>
                  <p class="current">Current label: <strong>${escapeHtml(request.currentLabel.canonicalName)}</strong></p>
                </div>
                <audio ${isComplete ? "disabled " : ""}controls preload="metadata" src="${clipUrl}"></audio>
                ${control}
              </section>
            `;
          })
          .join("");
  const statusPanel =
    record.status === "succeeded" && record.result !== undefined
      ? `<p class="status-note">Complete. <a href="/v1/jobs/${encodeURIComponent(record.id)}/result">Open result JSON</a>.</p>`
      : record.status === "failed"
        ? `<p class="status-note error">${escapeHtml(record.error?.message ?? "Job failed.")}</p>`
        : record.status === "awaiting-review"
          ? `<p class="status-note">Resolve each clip below to resume the job.</p>`
          : `<p class="status-note">Job is ${escapeHtml(record.status)}. This page refreshes while the job is active.</p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    ${shouldRefresh ? `<meta http-equiv="refresh" content="5">` : ""}
    <title>ReMuse Review ${escapeHtml(record.id)}</title>
    <style>
      :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; background: #f6f4ef; color: #171717; }
      main { max-width: 900px; margin: 0 auto; padding: 32px 20px 48px; }
      header { margin-bottom: 24px; }
      h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: 0; }
      h2 { margin: 4px 0 8px; font-size: 18px; letter-spacing: 0; }
      code { font-size: 13px; }
      a { color: #0d5f7c; }
      .status-pill { display: inline-block; padding: 4px 10px; border: 1px solid #c8c2b5; border-radius: 999px; background: #fffaf0; }
      .status-note { margin: 14px 0 0; }
      .error { color: #9d1c1c; }
      .progress-dialog, .review-card, .empty, .events { background: #fffdf8; border: 1px solid #d7d0c2; border-radius: 8px; padding: 18px; margin: 16px 0; }
      .progress-dialog { box-shadow: 0 14px 40px rgba(31, 111, 95, 0.12); }
      .progress-heading { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; }
      .progress-heading h2 { margin: 0; }
      .progress-heading span { font-weight: 700; color: #1f6f5f; }
      progress { display: block; width: 100%; height: 14px; margin: 14px 0; accent-color: #1f6f5f; }
      .progress-dialog p { margin: 6px 0; }
      .review-card.is-resolved { opacity: 0.52; background: #efebe2; }
      .eyebrow { margin: 0; color: #6c655d; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
      .current { margin: 0 0 14px; color: #4f4a44; }
      .resolved-label { margin: 12px 0 0; color: #4f4a44; }
      audio { display: block; width: 100%; margin: 12px 0 16px; }
      .review-actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
      form { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
      label { display: grid; gap: 6px; font-size: 13px; color: #4f4a44; }
      select, button { font: inherit; min-height: 38px; border-radius: 6px; border: 1px solid #aaa195; background: #ffffff; color: #171717; }
      select { min-width: 180px; padding: 0 10px; }
      button { padding: 0 16px; cursor: pointer; background: #1f6f5f; color: white; border-color: #1f6f5f; }
      .discard-button { background: #fbf8f1; color: #6b3027; border-color: #b99990; }
      ul { padding-left: 20px; }
      li { margin: 8px 0; }
      @media (prefers-color-scheme: dark) {
        body { background: #171614; color: #f5f1e8; }
        a { color: #7fd0ee; }
        .status-pill, .progress-dialog, .review-card, .empty, .events { background: #22201d; border-color: #504a42; }
        .review-card.is-resolved { background: #1a1917; }
        .status-pill { background: #29251f; }
        .progress-heading span { color: #5ec4ad; }
        .eyebrow, .current, .resolved-label, label { color: #c8bfb1; }
        select { background: #171614; color: #f5f1e8; border-color: #6d655b; }
        .discard-button { background: #2a211f; color: #f0b7ab; border-color: #80564e; }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>ReMuse Job Status</h1>
        <p>Job <code>${escapeHtml(record.id)}</code> <span class="status-pill">${escapeHtml(record.status)}</span></p>
        ${statusPanel}
      </header>
      ${progressPanel}
      ${requestCards}
      <section class="events">
        <h2>Recent Events</h2>
        <ul>${lastEvents(record)}</ul>
      </section>
    </main>
  </body>
</html>`;
}

function publicReviewRequests(record: PipelineJobRecord): unknown[] {
  return (
    record.pendingInstrumentReview?.requests.map((request) => ({
      ...request,
      clipUrl: `/v1/jobs/${record.id}/review-requests/${request.id}/clip`
    })) ?? []
  );
}

function publicDiagnosticTrackBounces(record: PipelineJobRecord): unknown[] {
  return (
    record.result?.bounce.diagnosticTrackBounces?.map((track) => ({
      ...track,
      audioUrl: `/v1/jobs/${record.id}/diagnostic-track-bounces/${encodeURIComponent(track.bounce.id)}`
    })) ?? []
  );
}

function jobSummary(record: PipelineJobRecord): unknown {
  return {
    id: record.id,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    reviewUrl: `/review/${record.id}`,
    inputArtifact: record.inputArtifact,
    events: record.events,
    pendingInstrumentReviews: publicReviewRequests(record),
    diagnosticTrackBounces: publicDiagnosticTrackBounces(record),
    result: record.result,
    error: record.error
  };
}

export class JobApi {
  private readonly artifactStore: FileArtifactStore;
  private readonly jobStore: FileJobStore;
  private readonly runner: PipelineJobRunner;
  private readonly maxUploadBytes: number;
  private readonly options: JobApiOptions;

  constructor(
    artifactStore: FileArtifactStore,
    jobStore: FileJobStore,
    runner: PipelineJobRunner,
    maxUploadBytes: number,
    options: JobApiOptions
  ) {
    this.artifactStore = artifactStore;
    this.jobStore = jobStore;
    this.runner = runner;
    this.maxUploadBytes = maxUploadBytes;
    this.options = options;
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
    this.openReviewPage(jobId);

    return {
      jobId,
      status: record.status,
      statusUrl: `/v1/jobs/${jobId}`,
      resultUrl: `/v1/jobs/${jobId}/result`,
      reviewUrl: `/review/${jobId}`,
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

  async getJobBounce(jobId: string): Promise<{ bytes: Buffer; filename: string }> {
    const record = await this.jobStore.get(jobId);
    if (record === undefined) {
      throw new HttpError(404, `Job ${jobId} was not found.`);
    }

    if (record.status !== "succeeded" || record.result === undefined) {
      throw new HttpError(409, `Job ${jobId} is ${record.status}; bounce is not ready.`);
    }

    const bounce = record.result.bounce.bounce;
    if (!bounce.uri.startsWith("file://")) {
      throw new HttpError(409, `Job ${jobId} bounce is not file-backed and cannot be streamed.`);
    }

    return {
      bytes: await readFile(fileURLToPath(bounce.uri)),
      filename: bounce.filename
    };
  }

  async getDiagnosticTrackBounces(jobId: string): Promise<unknown> {
    const record = await this.jobStore.get(jobId);
    if (record === undefined) {
      throw new HttpError(404, `Job ${jobId} was not found.`);
    }

    if (record.status !== "succeeded" || record.result === undefined) {
      throw new HttpError(409, `Job ${jobId} is ${record.status}; diagnostic track bounces are not ready.`);
    }

    return {
      jobId,
      tracks: publicDiagnosticTrackBounces(record)
    };
  }

  async getDiagnosticTrackBounce(jobId: string, diagnosticBounceId: string): Promise<{ bytes: Buffer; filename: string }> {
    const record = await this.jobStore.get(jobId);
    if (record === undefined) {
      throw new HttpError(404, `Job ${jobId} was not found.`);
    }

    if (record.status !== "succeeded" || record.result === undefined) {
      throw new HttpError(409, `Job ${jobId} is ${record.status}; diagnostic track bounce is not ready.`);
    }

    const diagnostic = record.result.bounce.diagnosticTrackBounces?.find(
      (track) => track.bounce.id === diagnosticBounceId || String(track.trackIndex + 1) === diagnosticBounceId
    );
    if (diagnostic === undefined) {
      throw new HttpError(404, `Diagnostic track bounce ${diagnosticBounceId} was not found.`);
    }
    if (!diagnostic.bounce.uri.startsWith("file://")) {
      throw new HttpError(409, `Diagnostic track bounce ${diagnosticBounceId} is not file-backed and cannot be streamed.`);
    }

    return {
      bytes: await readFile(fileURLToPath(diagnostic.bounce.uri)),
      filename: diagnostic.bounce.filename
    };
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

  async getInstrumentReviewPage(jobId: string): Promise<string> {
    const record = await this.jobStore.get(jobId);
    if (record === undefined) {
      throw new HttpError(404, `Job ${jobId} was not found.`);
    }

    return renderReviewPage(record);
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
    if (request.status !== "pending") {
      throw new HttpError(409, `Review request ${reviewRequestId} is already ${request.status}.`);
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
    return this.applyManualReviewUpdate(jobId, pending, requests, instrumentStems);
  }

  async discardInstrumentReview(jobId: string, reviewRequestId: string): Promise<unknown> {
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
    if (request.status !== "pending") {
      throw new HttpError(409, `Review request ${reviewRequestId} is already ${request.status}.`);
    }

    const requests = pending.requests.map((item, index) =>
      index === requestIndex
        ? {
            ...item,
            status: "discarded" as const
          }
        : item
    );
    const instrumentStems = pending.state.instrumentStems.filter((stem) => stem.stem.id !== request.stemArtifactId);

    return this.applyManualReviewUpdate(jobId, pending, requests, instrumentStems);
  }

  private async applyManualReviewUpdate(
    jobId: string,
    pending: NonNullable<PipelineJobRecord["pendingInstrumentReview"]>,
    requests: NonNullable<PipelineJobRecord["pendingInstrumentReview"]>["requests"],
    instrumentStems: NonNullable<PipelineJobRecord["pendingInstrumentReview"]>["state"]["instrumentStems"]
  ): Promise<unknown> {
    const updatedPending = {
      state: {
        ...pending.state,
        instrumentStems
      },
      requests
    };
    const allReviewed = requests.every((item) => item.status !== "pending");
    const updatedRecord = await this.jobStore.updatePendingInstrumentReview(
      jobId,
      updatedPending,
      allReviewed ? "running" : "awaiting-review"
    );

    if (allReviewed) {
      this.runner.startResume(updatedRecord);
    }

    return {
      jobId,
      status: allReviewed ? "running" : "awaiting-review",
      requests: publicReviewRequests(updatedRecord)
    };
  }

  private openReviewPage(jobId: string): void {
    if (!this.options.autoOpenReview) {
      return;
    }

    const reviewUrl = new URL(`/review/${encodeURIComponent(jobId)}`, this.options.publicBaseUrl).toString();
    void Promise.resolve(this.options.openUrl(reviewUrl)).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Could not open review UI at ${reviewUrl}: ${message}`);
    });
  }
}

export function createJobServer(options: JobServerOptions): JobServerApp {
  const artifactStore = new FileArtifactStore({ rootDir: join(options.rootDir, "artifacts") });
  const jobStore = new FileJobStore({ rootDir: join(options.rootDir, "jobs") });
  const providers = typeof options.providers === "function" ? options.providers({ artifactStore }) : options.providers;
  const publicBaseUrl = options.publicBaseUrl ?? defaultPublicBaseUrl;
  const autoOpenReview = options.autoOpenReview ?? false;
  const openUrl = options.openUrl ?? openUrlWithDefaultBrowser;
  const runner = new PipelineJobRunner(jobStore, artifactStore, providers);
  const maxUploadBytes = options.maxUploadBytes ?? defaultMaxUploadBytes;
  const api = new JobApi(artifactStore, jobStore, runner, maxUploadBytes, {
    publicBaseUrl,
    autoOpenReview,
    openUrl
  });

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true });
        return;
      }

      if (request.method === "GET" && isDemoPageRoute(url.pathname)) {
        sendHtml(response, 200, await readDemoPage());
        return;
      }

      const reviewPageJobId = request.method === "GET" ? routeReviewPage(url.pathname) : undefined;
      if (reviewPageJobId !== undefined) {
        sendHtml(response, 200, await api.getInstrumentReviewPage(reviewPageJobId));
        return;
      }

      const reviewFormRoute = request.method === "POST" ? routeReviewForm(url.pathname) : undefined;
      if (reviewFormRoute !== undefined) {
        const action = reviewActionFromFormBody(await readFormBody(request, maxUploadBytes));
        if (action.kind === "discard") {
          await api.discardInstrumentReview(reviewFormRoute.jobId, reviewFormRoute.reviewRequestId);
        } else {
          await api.submitInstrumentReview(reviewFormRoute.jobId, reviewFormRoute.reviewRequestId, action.selection);
        }
        redirect(response, `/review/${encodeURIComponent(reviewFormRoute.jobId)}`);
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

      const bounceJobId = request.method === "GET" ? routeJobId(url.pathname, "/bounce") : undefined;
      if (bounceJobId !== undefined) {
        const bounce = await api.getJobBounce(bounceJobId);
        sendAudio(response, bounce.bytes, bounce.filename);
        return;
      }

      const resultJobId = request.method === "GET" ? routeJobId(url.pathname, "/result") : undefined;
      if (resultJobId !== undefined) {
        sendJson(response, 200, await api.getJobResult(resultJobId));
        return;
      }

      const diagnosticTrackBounceRoute = request.method === "GET" ? routeDiagnosticTrackBounce(url.pathname) : undefined;
      if (diagnosticTrackBounceRoute !== undefined) {
        const diagnostic = await api.getDiagnosticTrackBounce(
          diagnosticTrackBounceRoute.jobId,
          diagnosticTrackBounceRoute.diagnosticBounceId
        );
        sendAudio(response, diagnostic.bytes, diagnostic.filename);
        return;
      }

      const diagnosticTrackBouncesJobId =
        request.method === "GET" ? routeDiagnosticTrackBounces(url.pathname) : undefined;
      if (diagnosticTrackBouncesJobId !== undefined) {
        sendJson(response, 200, await api.getDiagnosticTrackBounces(diagnosticTrackBouncesJobId));
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
