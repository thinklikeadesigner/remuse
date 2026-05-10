import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FileJobStore } from "../jobs/fileJobStore.ts";
import { PipelineJobRunner } from "../jobs/pipelineJobRunner.ts";
import type { PipelineJobRecord } from "../jobs/types.ts";
import type { HumanInstrumentReviewRequest, InstrumentLabel, InstrumentStem, PipelineProviders, PipelineStepName } from "../pipeline/types.ts";
import { labelForManualInstrumentSelection, normalizeInstrumentName } from "../pipeline/naming.ts";
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
  "instrument-stem-separation",
  "instrument-label-normalization",
  "manual-instrument-review",
  "midi-conversion",
  "opendaw-session-create",
  "opendaw-midi-import",
  "opendaw-bounce"
];
const progressStepLabels: Partial<Record<PipelineStepName, string>> = {
  "validate-input": "Validate Input",
  "instrument-stem-separation": "Stem Separation",
  "instrument-label-normalization": "Labeling",
  "manual-instrument-review": "Manual Review",
  "midi-conversion": "MIDI Conversion",
  "opendaw-session-create": "Create ReMuse Session",
  "opendaw-midi-import": "MIDI Merge",
  "opendaw-bounce": "Output ReMused File"
};
const demoOutputContentTypes: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  mp4: "video/mp4",
  png: "image/png",
  webp: "image/webp"
};

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

function sendStreamError(response: ServerResponse, statusCode: number, message: string): void {
  if (!response.headersSent) {
    sendJson(response, statusCode, { error: { message } });
    return;
  }

  response.destroy(new Error(message));
}

async function readDemoPage(): Promise<string> {
  return readFile(join(process.cwd(), "src", "demo", "demo.html"), "utf8");
}

function isDemoPageRoute(pathname: string): boolean {
  return pathname === "/" || pathname === "/demo" || pathname === "/demo.html";
}

function routeDemoOutputAsset(pathname: string): string | undefined {
  const match = pathname.match(/^\/output\/([^/]+)$/);
  if (match === null) {
    return undefined;
  }

  const filename = decodeURIComponent(match[1] ?? "");
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
    throw new HttpError(400, "Invalid demo asset filename.");
  }

  return filename;
}

function contentTypeForDemoOutputAsset(filename: string): string {
  const extension = filename.split(".").at(-1)?.toLowerCase() ?? "";
  return demoOutputContentTypes[extension] ?? "application/octet-stream";
}

type ByteRange = {
  start: number;
  end: number;
};

export type DemoOutputAssetResponse = {
  assetPath: string;
  statusCode: 200 | 206;
  headers: Record<string, string | number>;
  range?: ByteRange;
};

function assertDemoOutputFilename(filename: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
    throw new HttpError(400, "Invalid demo asset filename.");
  }
}

function parseByteRange(rangeHeader: string | undefined, size: number): ByteRange | undefined {
  if (rangeHeader === undefined) {
    return undefined;
  }

  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (match === null) {
    throw new HttpError(416, "Invalid byte range.");
  }

  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (startText.length === 0 && endText.length === 0) {
    throw new HttpError(416, "Invalid byte range.");
  }

  const start =
    startText.length === 0
      ? Math.max(0, size - Number(endText))
      : Number(startText);
  const end = endText.length === 0 ? size - 1 : Number(endText);

  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) {
    throw new HttpError(416, "Requested byte range is not satisfiable.");
  }

  return {
    start,
    end: Math.min(end, size - 1)
  };
}

export async function resolveDemoOutputAsset(
  filename: string,
  rangeHeader?: string | undefined
): Promise<DemoOutputAssetResponse> {
  assertDemoOutputFilename(filename);
  const assetPath = join(process.cwd(), "src", "demo", "output", filename);
  let assetStat: Awaited<ReturnType<typeof stat>>;
  try {
    assetStat = await stat(assetPath);
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new HttpError(404, `Demo asset ${filename} was not found.`);
    }
    throw error;
  }

  if (!assetStat.isFile()) {
    throw new HttpError(404, `Demo asset ${filename} was not found.`);
  }

  const contentType = contentTypeForDemoOutputAsset(filename);
  const range = parseByteRange(rangeHeader, assetStat.size);
  const headers: Record<string, string | number> = {
    "accept-ranges": "bytes",
    "content-type": contentType
  };

  if (range === undefined) {
    return {
      assetPath,
      statusCode: 200,
      headers: {
        ...headers,
        "content-length": assetStat.size
      }
    };
  }

  return {
    assetPath,
    statusCode: 206,
    headers: {
      ...headers,
      "content-length": range.end - range.start + 1,
      "content-range": `bytes ${range.start}-${range.end}/${assetStat.size}`
    },
    range
  };
}

async function sendDemoOutputAsset(
  request: IncomingMessage,
  response: ServerResponse,
  filename: string
): Promise<void> {
  const asset = await resolveDemoOutputAsset(filename, singleHeader(request.headers.range));

  if (asset.range === undefined) {
    response.writeHead(asset.statusCode, asset.headers);
    if (request.method === "HEAD") {
      response.end();
      return;
    }

    createReadStream(asset.assetPath).once("error", (error) => sendStreamError(response, 500, error.message)).pipe(response);
    return;
  }

  response.writeHead(asset.statusCode, asset.headers);

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(asset.assetPath, { start: asset.range.start, end: asset.range.end })
    .once("error", (error) => sendStreamError(response, 500, error.message))
    .pipe(response);
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

function routeReviewComplete(pathname: string): string | undefined {
  return pathname.match(/^\/review\/([^/]+)\/complete$/)?.[1];
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
type ReviewCompletionChoice = { discard: boolean; selection?: string };

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

function reviewCompletionChoicesFromFormBody(body: URLSearchParams): Map<string, ReviewCompletionChoice> {
  const choices = new Map<string, ReviewCompletionChoice>();

  for (const reviewRequestId of body.getAll("reviewId")) {
    const trimmedId = reviewRequestId.trim();
    if (trimmedId.length === 0) {
      continue;
    }

    const discard = body.get(`discard:${trimmedId}`) === "1";
    const selection = body.get(`instrument:${trimmedId}`)?.trim();
    choices.set(trimmedId, {
      discard,
      ...(selection === undefined || selection.length === 0 ? {} : { selection })
    });
  }

  if (choices.size === 0) {
    throw new HttpError(400, "Manual review completion form must include at least one stem.");
  }

  return choices;
}

function reviewUpdateCompleted(result: unknown): boolean {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return false;
  }

  const status = (result as Record<string, unknown>).status;
  return status === "running" || status === "cancelled";
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
  return progressStepLabels[step] ?? step
    .split("-")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function openReviewPage(jobId: string, options: JobApiOptions): void {
  if (!options.autoOpenReview) {
    return;
  }

  const reviewUrl = new URL(`/review/${encodeURIComponent(jobId)}`, options.publicBaseUrl).toString();
  void Promise.resolve(options.openUrl(reviewUrl)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Could not open review UI at ${reviewUrl}: ${message}`);
  });
}

function progressForRecord(record: PipelineJobRecord): { percent: number; step: string; message: string } {
  if (record.status === "succeeded") {
    return { percent: 100, step: "Complete", message: "The ReMuse job has completed." };
  }

  if (record.status === "cancelled") {
    return { percent: 100, step: "Cancelled", message: record.error?.message ?? "The ReMuse job was cancelled." };
  }

  const latestByStep = new Map<PipelineStepName, PipelineJobRecord["events"][number]>();
  for (const event of record.events) {
    latestByStep.set(event.step, event);
  }

  const completedSteps = progressSteps.filter((step) => {
    const status = latestByStep.get(step)?.status;
    return status === "succeeded" || status === "skipped";
  }).length;
  const latestEvent = [...record.events].reverse().find((event) => progressSteps.includes(event.step));
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

export function renderReviewClosedPage(jobId: string, status: "running" | "cancelled" = "running"): string {
  const safeJobId = escapeHtml(jobId);
  const heading = status === "cancelled" ? "ReMuse Cancelled" : "Manual Review Complete";
  const message =
    status === "cancelled"
      ? `ReMuse job <code>${safeJobId}</code> was cancelled. This tab should close automatically.`
      : `ReMuse is continuing job <code>${safeJobId}</code>. This tab should close automatically.`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${heading} ${safeJobId}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #090909;
        --panel: #141414;
        --line: #2b2b2b;
        --text: #f6f2ea;
        --muted: #aba49a;
        --gold: #d8ae5f;
        --green: #4d9f7a;
        --shadow: rgba(0, 0, 0, 0.45);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: linear-gradient(180deg, #101010, var(--bg) 70%); color: var(--text); }
      main { width: min(520px, calc(100% - 32px)); background: rgba(20, 20, 20, 0.92); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; box-shadow: 0 22px 80px var(--shadow); padding: 22px; }
      h1 { margin: 0 0 8px; font-size: 22px; letter-spacing: 0; }
      p { margin: 8px 0 0; color: var(--muted); line-height: 1.45; }
      code { color: var(--gold); }
      .status-dot { display: inline-block; width: 10px; height: 10px; margin-right: 8px; background: var(--green); box-shadow: 0 0 18px rgba(77, 159, 122, 0.7); vertical-align: middle; }
    </style>
  </head>
  <body>
    <main>
      <h1><span class="status-dot" aria-hidden="true"></span>${heading}</h1>
      <p>${message}</p>
      <p>If it stays open, your browser blocked the close request and you can close it manually.</p>
    </main>
    <script>
      window.setTimeout(() => {
        window.close();
      }, 150);
    </script>
  </body>
</html>`;
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
      ? `<section class="empty"><p>No pending review stems.</p></section>`
      : `<form class="review-form" method="post" action="/review/${encodeURIComponent(record.id)}/complete" data-review-form>
          ${requests
            .map((request, index) => {
              const clipUrl = `/v1/jobs/${encodeURIComponent(record.id)}/review-requests/${encodeURIComponent(request.id)}/clip`;
              const isDiscarded = request.status === "discarded";
              const selectedCanonicalName = request.selectedLabel?.canonicalName;
              const options = request.options
                .map((option) => {
                  const selected = selectedCanonicalName === option.canonicalName;
                  return `<option value="${escapeHtml(option.displayName)}"${selected ? " selected" : ""}>${escapeHtml(option.displayName)}</option>`;
                })
                .join("");

              return `
                <section class="review-card${isDiscarded ? " is-discarded" : ""}" data-review-card>
                  <input type="hidden" name="reviewId" value="${escapeHtml(request.id)}">
                  <input type="hidden" name="discard:${escapeHtml(request.id)}" value="${isDiscarded ? "1" : "0"}" data-discard-input>
                  <div>
                    <p class="eyebrow">Stem ${index + 1} of ${requests.length}</p>
                    <h2>${escapeHtml(request.stemFilename)}</h2>
                    <p class="current">Provider label: <strong>${escapeHtml(request.currentLabel.canonicalName)}</strong></p>
                  </div>
                  <audio controls preload="metadata" src="${clipUrl}"></audio>
                  <div class="review-actions">
                    <label>
                      Instrument
                      <select name="instrument:${escapeHtml(request.id)}" data-instrument-select>
                        <option value="">Select instrument</option>
                        ${options}
                      </select>
                    </label>
                    <button class="discard-button" type="button" data-discard-button>${isDiscarded ? "Restore" : "Discard"}</button>
                  </div>
                </section>
              `;
            })
            .join("")}
          <div class="review-complete-bar">
            <button type="submit" data-complete-review disabled>Complete Review</button>
          </div>
        </form>`;
  const statusPanel =
    record.status === "succeeded" && record.result !== undefined
      ? `<p class="status-note">Complete. <a href="/v1/jobs/${encodeURIComponent(record.id)}/result">Open Result JSON</a>.</p>`
      : record.status === "failed"
        ? `<p class="status-note error">${escapeHtml(record.error?.message ?? "Job failed.")}</p>`
        : record.status === "cancelled"
          ? `<p class="status-note error">${escapeHtml(record.error?.message ?? "Job cancelled.")}</p>`
          : record.status === "awaiting-review"
            ? `<p class="status-note">Review every stem, discard anything unusable, then complete review to resume the job.</p>`
          : `<p class="status-note">Job is ${escapeHtml(record.status)}. This page refreshes while the job is active.</p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    ${shouldRefresh ? `<meta http-equiv="refresh" content="5">` : ""}
    <title>ReMuse Review ${escapeHtml(record.id)}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #090909;
        --panel: #141414;
        --panel-2: #1b1b1b;
        --line: #2b2b2b;
        --text: #f6f2ea;
        --muted: #aba49a;
        --gold: #d8ae5f;
        --red: #9d2f33;
        --green: #4d9f7a;
        --shadow: rgba(0, 0, 0, 0.45);
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; background: linear-gradient(180deg, #101010, var(--bg) 70%); color: var(--text); }
      main { width: min(960px, 100%); margin: 0 auto; padding: 32px 24px 48px; }
      header { margin-bottom: 22px; padding-bottom: 18px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
      h1 { margin: 0 0 8px; font-size: 28px; letter-spacing: 0; }
      h2 { margin: 4px 0 8px; font-size: 18px; letter-spacing: 0; }
      code { font-size: 13px; color: var(--gold); }
      a { color: var(--gold); }
      .status-pill { display: inline-block; padding: 4px 10px; border: 1px solid rgba(216, 174, 95, 0.55); border-radius: 999px; background: #12100d; color: var(--gold); }
      .status-note { margin: 14px 0 0; color: var(--muted); }
      .error { color: #f0b7ab; }
      .progress-dialog, .review-card, .empty, .events { background: rgba(20, 20, 20, 0.92); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; box-shadow: 0 22px 80px var(--shadow); padding: 18px; margin: 16px 0; }
      .progress-heading { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; }
      .progress-heading h2 { margin: 0; }
      .progress-heading span { color: var(--gold); font-weight: 780; font-variant-numeric: tabular-nums; }
      progress { appearance: none; -webkit-appearance: none; display: block; width: 100%; height: 10px; margin: 14px 0; border: 1px solid rgba(255, 255, 255, 0.16); background: #101010; }
      progress::-webkit-progress-bar { background: #101010; }
      progress::-webkit-progress-value { background: linear-gradient(90deg, var(--red), var(--gold), var(--green)); }
      progress::-moz-progress-bar { background: linear-gradient(90deg, var(--red), var(--gold), var(--green)); }
      .progress-dialog p { margin: 6px 0; color: var(--muted); }
      .progress-dialog strong { color: var(--text); }
      .review-form { display: block; }
      .review-card.is-discarded { opacity: 0.54; background: rgba(27, 27, 27, 0.72); }
      .eyebrow { margin: 0; color: var(--gold); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
      .current { margin: 0 0 14px; color: var(--muted); }
      .resolved-label { margin: 12px 0 0; color: var(--muted); }
      audio { display: block; width: 100%; margin: 12px 0 16px; }
      .review-actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
      form { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
      label { display: grid; gap: 6px; font-size: 13px; color: var(--muted); }
      select, button { font: inherit; min-height: 38px; border-radius: 6px; border: 1px solid var(--line); background: var(--panel-2); color: var(--text); }
      select { min-width: 180px; padding: 0 10px; }
      button { padding: 0 16px; cursor: pointer; background: var(--green); color: #07110d; border-color: var(--green); font-weight: 720; }
      button:disabled { cursor: not-allowed; background: #343434; border-color: #4a4a4a; color: #8f8f8f; }
      .discard-button { background: #251415; color: #f0b7ab; border-color: rgba(157, 47, 51, 0.7); }
      .review-complete-bar { position: sticky; bottom: 0; display: flex; justify-content: flex-end; margin: 18px 0; padding: 14px 0 0; background: linear-gradient(180deg, transparent, var(--bg) 30%); }
      .review-complete-bar button { min-width: 180px; }
      ul { padding-left: 20px; }
      li { margin: 8px 0; color: var(--muted); }
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
    <script>
      const reviewForm = document.querySelector("[data-review-form]");
      if (reviewForm) {
        const cards = Array.from(document.querySelectorAll("[data-review-card]"));
        const completeButton = document.querySelector("[data-complete-review]");
        const isDiscarded = (card) => card.querySelector("[data-discard-input]")?.value === "1";
        const updateReviewReadiness = () => {
          const allReady = cards.length > 0 && cards.every((card) => {
            const select = card.querySelector("[data-instrument-select]");
            return isDiscarded(card) || Boolean(select?.value);
          });
          if (completeButton) {
            completeButton.disabled = !allReady;
          }
        };

        for (const button of document.querySelectorAll("[data-discard-button]")) {
          button.addEventListener("click", () => {
            const card = button.closest("[data-review-card]");
            const input = card?.querySelector("[data-discard-input]");
            if (!card || !input) {
              return;
            }

            const nextDiscarded = input.value !== "1";
            input.value = nextDiscarded ? "1" : "0";
            card.classList.toggle("is-discarded", nextDiscarded);
            button.textContent = nextDiscarded ? "Restore" : "Discard";
            updateReviewReadiness();
          });
        }

        for (const select of document.querySelectorAll("[data-instrument-select]")) {
          select.addEventListener("change", updateReviewReadiness);
        }

        reviewForm.addEventListener("submit", (event) => {
          updateReviewReadiness();
          if (completeButton?.disabled) {
            event.preventDefault();
            return;
          }

          if (cards.length > 0 && cards.every(isDiscarded)) {
            const confirmed = window.confirm("You are about to discard this ReMuse - are you sure?");
            if (!confirmed) {
              event.preventDefault();
            }
          }
        });

        updateReviewReadiness();
      }
    </script>
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

function manualReviewStemFilename(request: HumanInstrumentReviewRequest, label: InstrumentLabel, index: number): string {
  const stemNumber = request.stemFilename.match(/(?:^|\.)stem-(\d+)/i)?.[1] ?? String(index + 1).padStart(2, "0");
  const baseName = request.stemFilename.match(/^(.*?)(?:\.stem-\d+)(?:\.[^.]+)?\.wav$/i)?.[1] ?? request.stemFilename.replace(/\.wav$/i, "");
  return `${baseName}.stem-${stemNumber}.${normalizeInstrumentName(label.canonicalName)}.wav`;
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
    const instrumentStems = pending.state.instrumentStems;

    return this.applyManualReviewUpdate(jobId, pending, requests, instrumentStems);
  }

  async completeInstrumentReview(jobId: string, choices: Map<string, ReviewCompletionChoice>): Promise<unknown> {
    const record = await this.jobStore.get(jobId);
    if (record === undefined) {
      throw new HttpError(404, `Job ${jobId} was not found.`);
    }

    const pending = record.pendingInstrumentReview;
    if (record.status !== "awaiting-review" || pending === undefined) {
      throw new HttpError(409, `Job ${jobId} is ${record.status}; no manual review is pending.`);
    }

    const updatedRequests: HumanInstrumentReviewRequest[] = [];
    const keptStems: InstrumentStem[] = [];

    for (const [index, request] of pending.requests.entries()) {
      const choice = choices.get(request.id);
      if (choice === undefined) {
        throw new HttpError(400, `Manual review completion is missing a choice for ${request.id}.`);
      }

      if (choice.discard) {
        updatedRequests.push({
          ...request,
          status: "discarded"
        });
        continue;
      }

      const selection = choice.selection ?? request.selectedLabel?.canonicalName;
      if (selection === undefined || selection.trim().length === 0) {
        throw new HttpError(400, `Manual review completion is missing an instrument for ${request.stemFilename}.`);
      }

      const selectedLabel = labelForManualInstrumentSelection(selection, request.stemArtifactId);
      const stem = pending.state.instrumentStems.find((item) => item.stem.id === request.stemArtifactId);
      if (stem === undefined) {
        throw new HttpError(409, `Stem artifact ${request.stemArtifactId} was not found in pending review state.`);
      }

      const renamedStem = await this.artifactStore.renameAudioArtifact(
        stem.stem,
        manualReviewStemFilename(request, selectedLabel, index),
        {
          manualReviewInstrument: selectedLabel.canonicalName,
          normalizedInstrument: selectedLabel.canonicalName
        }
      );
      keptStems.push({
        ...stem,
        stem: renamedStem,
        label: selectedLabel
      });
      updatedRequests.push({
        ...request,
        stemFilename: renamedStem.filename,
        status: "resolved",
        selectedLabel
      });
    }

    if (keptStems.length === 0) {
      const cancelledRecord = await this.jobStore.cancel(jobId, {
        message: "All stems were discarded during manual review."
      });
      return jobSummary(cancelledRecord);
    }

    const updatedPending = {
      state: {
        ...pending.state,
        instrumentStems: keptStems
      },
      requests: updatedRequests
    };
    const updatedRecord = await this.jobStore.updatePendingInstrumentReview(jobId, updatedPending, "running");
    this.runner.startResume(updatedRecord);

    return {
      jobId,
      status: "running",
      requests: publicReviewRequests(updatedRecord)
    };
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
    const updatedRecord = await this.jobStore.updatePendingInstrumentReview(jobId, updatedPending, "awaiting-review");

    return {
      jobId,
      status: "awaiting-review",
      requests: publicReviewRequests(updatedRecord)
    };
  }

}

export function createJobServer(options: JobServerOptions): JobServerApp {
  const artifactStore = new FileArtifactStore({ rootDir: join(options.rootDir, "artifacts") });
  const jobStore = new FileJobStore({ rootDir: join(options.rootDir, "jobs") });
  const providers = typeof options.providers === "function" ? options.providers({ artifactStore }) : options.providers;
  const publicBaseUrl = options.publicBaseUrl ?? defaultPublicBaseUrl;
  const autoOpenReview = options.autoOpenReview ?? false;
  const openUrl = options.openUrl ?? openUrlWithDefaultBrowser;
  const runner = new PipelineJobRunner(jobStore, artifactStore, providers, {
    onManualReviewAwaiting: (record) => {
      openReviewPage(record.id, {
        publicBaseUrl,
        autoOpenReview,
        openUrl
      });
    }
  });
  const maxUploadBytes = options.maxUploadBytes ?? defaultMaxUploadBytes;
  const api = new JobApi(artifactStore, jobStore, runner, maxUploadBytes);

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

      const demoOutputFilename =
        request.method === "GET" || request.method === "HEAD" ? routeDemoOutputAsset(url.pathname) : undefined;
      if (demoOutputFilename !== undefined) {
        await sendDemoOutputAsset(request, response, demoOutputFilename);
        return;
      }

      const reviewPageJobId = request.method === "GET" ? routeReviewPage(url.pathname) : undefined;
      if (reviewPageJobId !== undefined) {
        sendHtml(response, 200, await api.getInstrumentReviewPage(reviewPageJobId));
        return;
      }

      const reviewCompleteJobId = request.method === "POST" ? routeReviewComplete(url.pathname) : undefined;
      if (reviewCompleteJobId !== undefined) {
        const result = await api.completeInstrumentReview(
          reviewCompleteJobId,
          reviewCompletionChoicesFromFormBody(await readFormBody(request, maxUploadBytes))
        );

        if (reviewUpdateCompleted(result)) {
          const status = (result as Record<string, unknown>).status === "cancelled" ? "cancelled" : "running";
          sendHtml(response, 200, renderReviewClosedPage(reviewCompleteJobId, status));
          return;
        }

        redirect(response, `/review/${encodeURIComponent(reviewCompleteJobId)}`);
        return;
      }

      const reviewFormRoute = request.method === "POST" ? routeReviewForm(url.pathname) : undefined;
      if (reviewFormRoute !== undefined) {
        const action = reviewActionFromFormBody(await readFormBody(request, maxUploadBytes));
        let result: unknown;
        if (action.kind === "discard") {
          result = await api.discardInstrumentReview(reviewFormRoute.jobId, reviewFormRoute.reviewRequestId);
        } else {
          result = await api.submitInstrumentReview(reviewFormRoute.jobId, reviewFormRoute.reviewRequestId, action.selection);
        }

        if (reviewUpdateCompleted(result)) {
          sendHtml(response, 200, renderReviewClosedPage(reviewFormRoute.jobId));
          return;
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
