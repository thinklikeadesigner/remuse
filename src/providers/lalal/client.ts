import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { AudioArtifact } from "../../pipeline/types.ts";

export const LALAL_DEFAULT_BASE_URL = "https://www.lalal.ai/api/v1";
export const LALAL_DEFAULT_POLL_INTERVAL_MS = 5_000;
export const LALAL_DEFAULT_MAX_POLL_ATTEMPTS = 120;
export const LALAL_MULTISTEM_SUPPORTED_STEMS = ["vocals", "drum", "piano", "bass", "electric_guitar", "acoustic_guitar"] as const;
export const LALAL_MULTISTEM_DEFAULT_STEMS = [...LALAL_MULTISTEM_SUPPORTED_STEMS] as const;
export const LALAL_MULTISTEM_MAX_OUTPUT_FILES = 7;

export type LalalMultistemStem = (typeof LALAL_MULTISTEM_SUPPORTED_STEMS)[number];
export type LalalSplitter = "auto" | "andromeda" | "perseus" | "orion" | "phoenix" | "lyra" | "lynx";
export type LalalExtractionLevel = "deep_extraction" | "clear_cut";

export type LalalUploadResult = {
  id: string;
  name?: string;
  size?: number;
  duration?: number;
  expires?: number;
  raw: unknown;
};

export type LalalTask = {
  taskId: string;
  raw: unknown;
};

export type LalalSplitTrack = {
  type: "stem" | "back";
  label: string;
  url: string;
  name?: string | null;
  size?: number | null;
  raw: Record<string, unknown>;
};

export type LalalTaskResult = {
  taskId: string;
  sourceId?: string;
  tracks: LalalSplitTrack[];
  duration?: number;
  raw: unknown;
};

export type LalalMultistemSplitRequest = {
  sourceId: string;
  stemList: readonly LalalMultistemStem[];
  splitter: LalalSplitter;
  extractionLevel: LalalExtractionLevel;
  encoderFormat: "wav";
  dereverbEnabled: boolean;
  idempotencyKey?: string;
};

export type LalalClientOptions = {
  licenseKey: string;
  baseUrl?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  fetchImpl?: typeof fetch;
};

function objectValue(input: unknown): Record<string, unknown> | undefined {
  return input !== null && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : undefined;
}

function arrayValue(input: unknown): unknown[] | undefined {
  return Array.isArray(input) ? input : undefined;
}

function stringValue(input: unknown): string | undefined {
  return typeof input === "string" && input.trim().length > 0 ? input : undefined;
}

function numberValue(input: unknown): number | undefined {
  return typeof input === "number" && Number.isFinite(input) ? input : undefined;
}

function errorMessageFromJson(input: unknown): string | undefined {
  const root = objectValue(input);
  const detail = root?.detail;
  if (typeof detail === "string") {
    return detail;
  }

  if (detail !== undefined) {
    return JSON.stringify(detail);
  }

  const code = stringValue(root?.code);
  return code === undefined ? undefined : `LALAL.AI error code: ${code}`;
}

async function parseJsonResponse(response: Response, label: string): Promise<unknown> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text.length === 0 ? {} : (JSON.parse(text) as unknown);
  } catch {
    if (!response.ok) {
      throw new Error(`LALAL.AI ${label} request failed: ${response.status} ${response.statusText}${text.length > 0 ? `: ${text}` : ""}`);
    }

    throw new Error(`LALAL.AI ${label} response was not valid JSON.`);
  }

  if (!response.ok) {
    throw new Error(`LALAL.AI ${label} request failed: ${response.status} ${response.statusText}: ${errorMessageFromJson(parsed) ?? text}`);
  }

  return parsed;
}

async function readArtifactBytes(artifact: AudioArtifact): Promise<Buffer> {
  const url = new URL(artifact.uri);
  if (url.protocol === "file:") {
    return readFile(fileURLToPath(url));
  }

  const response = await fetch(artifact.uri);
  if (!response.ok) {
    throw new Error(`Could not read source artifact ${artifact.uri}: ${response.status} ${response.statusText}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

function contentDispositionForFilename(filename: string): string {
  if (/^[\x20-\x7e]+$/.test(filename)) {
    return `attachment; filename="${filename.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }

  return `attachment; filename*=utf-8''${encodeURIComponent(filename)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeTrack(input: unknown): LalalSplitTrack | undefined {
  const track = objectValue(input);
  if (track === undefined) {
    return undefined;
  }

  const type = stringValue(track?.type);
  const label = stringValue(track?.label);
  const url = stringValue(track?.url);
  const name = stringValue(track.name);
  const size = numberValue(track.size);

  if ((type !== "stem" && type !== "back") || label === undefined || url === undefined) {
    return undefined;
  }

  return {
    type,
    label,
    url,
    ...(name === undefined ? {} : { name }),
    ...(size === undefined ? {} : { size }),
    raw: track
  };
}

function taskErrorMessage(task: Record<string, unknown>, taskId: string): string {
  const error = task.error;
  if (typeof error === "string") {
    return error;
  }

  if (error !== undefined) {
    return JSON.stringify(error);
  }

  return `LALAL.AI task ${taskId} failed.`;
}

export class LalalClient {
  readonly baseUrl: string;
  private readonly licenseKey: string;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: LalalClientOptions) {
    this.licenseKey = options.licenseKey;
    this.baseUrl = options.baseUrl ?? LALAL_DEFAULT_BASE_URL;
    this.pollIntervalMs = options.pollIntervalMs ?? LALAL_DEFAULT_POLL_INTERVAL_MS;
    this.maxPollAttempts = options.maxPollAttempts ?? LALAL_DEFAULT_MAX_POLL_ATTEMPTS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async uploadAudio(inputAudio: AudioArtifact): Promise<LalalUploadResult> {
    const bytes = await readArtifactBytes(inputAudio);
    const response = await this.fetchImpl(new URL("upload/", this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`), {
      method: "POST",
      headers: {
        "Content-Disposition": contentDispositionForFilename(inputAudio.filename),
        "Content-Type": "application/octet-stream",
        "X-License-Key": this.licenseKey
      },
      body: new Blob([new Uint8Array(bytes)], { type: "audio/wav" })
    });
    const raw = await parseJsonResponse(response, "upload");
    const root = objectValue(raw);
    const id = stringValue(root?.id);

    if (id === undefined) {
      throw new Error("LALAL.AI upload response did not include a source id.");
    }
    const name = stringValue(root?.name);
    const size = numberValue(root?.size);
    const duration = numberValue(root?.duration);
    const expires = numberValue(root?.expires);

    return {
      id,
      ...(name === undefined ? {} : { name }),
      ...(size === undefined ? {} : { size }),
      ...(duration === undefined ? {} : { duration }),
      ...(expires === undefined ? {} : { expires }),
      raw
    };
  }

  async createMultistemSplit(request: LalalMultistemSplitRequest): Promise<LalalTask> {
    const response = await this.fetchImpl(new URL("split/multistem/", this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-License-Key": this.licenseKey
      },
      body: JSON.stringify({
        source_id: request.sourceId,
        presets: {
          splitter: request.splitter,
          dereverb_enabled: request.dereverbEnabled,
          encoder_format: request.encoderFormat,
          stem_list: request.stemList,
          extraction_level: request.extractionLevel
        },
        idempotency_key: request.idempotencyKey ?? randomUUID()
      })
    });
    const raw = await parseJsonResponse(response, "multistem split");
    const root = objectValue(raw);
    const taskId = stringValue(root?.task_id);

    if (taskId === undefined) {
      throw new Error("LALAL.AI multistem response did not include a task id.");
    }

    return {
      taskId,
      raw
    };
  }

  async checkTask(taskId: string): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(new URL("check/", this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-License-Key": this.licenseKey
      },
      body: JSON.stringify({ task_ids: [taskId] })
    });
    const raw = await parseJsonResponse(response, "check");
    const result = objectValue(objectValue(raw)?.result);
    const task = objectValue(result?.[taskId]);

    if (task === undefined) {
      throw new Error(`LALAL.AI check response did not include task ${taskId}.`);
    }

    return task;
  }

  async waitForResult(taskId: string): Promise<LalalTaskResult> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const task = await this.checkTask(taskId);
      const status = stringValue(task.status);

      if (status === "success") {
        const result = objectValue(task.result);
        const tracks = arrayValue(result?.tracks)?.map(normalizeTrack).filter((track): track is LalalSplitTrack => track !== undefined) ?? [];
        const sourceId = stringValue(task.source_id);
        const duration = numberValue(result?.duration);

        return {
          taskId,
          ...(sourceId === undefined ? {} : { sourceId }),
          tracks,
          ...(duration === undefined ? {} : { duration }),
          raw: task
        };
      }

      if (status === "error" || status === "server_error") {
        throw new Error(taskErrorMessage(task, taskId));
      }

      if (status === "cancelled") {
        throw new Error(`LALAL.AI task ${taskId} was cancelled.`);
      }

      if (status !== "progress") {
        throw new Error(`LALAL.AI task ${taskId} returned unknown status "${status ?? "missing"}".`);
      }

      await sleep(this.pollIntervalMs);
    }

    throw new Error(`LALAL.AI task ${taskId} did not complete after ${this.maxPollAttempts} polling attempts.`);
  }

  async deleteSource(sourceId: string): Promise<void> {
    const response = await this.fetchImpl(new URL("delete/", this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-License-Key": this.licenseKey
      },
      body: JSON.stringify({ source_id: sourceId })
    });
    await parseJsonResponse(response, "delete");
  }
}
