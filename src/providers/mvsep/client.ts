import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { AudioArtifact } from "../../pipeline/types.ts";

export type MvsepSeparationStatus = "not_found" | "waiting" | "processing" | "done" | "failed" | "distributing" | "merging";

export type MvsepSeparationRequest = {
  inputAudio: AudioArtifact;
  sepType: number;
  outputFormat: number;
  addOpt1?: string;
  addOpt2?: string;
  addOpt3?: string;
  isDemo?: boolean;
};

export type MvsepCreateResult = {
  hash: string;
  link?: string;
  raw: unknown;
};

export type MvsepStatusResult = {
  success: boolean;
  status?: MvsepSeparationStatus;
  data?: Record<string, unknown>;
  raw: unknown;
};

export type MvsepClientOptions = {
  apiToken: string;
  baseUrl?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  fetchImpl?: typeof fetch;
};

const defaultBaseUrl = "https://mvsep.com";
const defaultPollIntervalMs = 10_000;
const defaultMaxPollAttempts = 120;

function objectValue(input: unknown): Record<string, unknown> | undefined {
  return input !== null && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : undefined;
}

function stringValue(input: unknown): string | undefined {
  return typeof input === "string" && input.trim().length > 0 ? input : undefined;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`MVSEP request failed: ${response.status} ${response.statusText}${text.length > 0 ? `: ${text}` : ""}`);
  }

  return JSON.parse(text) as unknown;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MvsepClient {
  readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: MvsepClientOptions) {
    this.apiToken = options.apiToken;
    this.baseUrl = options.baseUrl ?? defaultBaseUrl;
    this.pollIntervalMs = options.pollIntervalMs ?? defaultPollIntervalMs;
    this.maxPollAttempts = options.maxPollAttempts ?? defaultMaxPollAttempts;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createSeparation(request: MvsepSeparationRequest): Promise<MvsepCreateResult> {
    const bytes = await readArtifactBytes(request.inputAudio);
    const form = new FormData();

    form.set("api_token", this.apiToken);
    form.set("sep_type", String(request.sepType));
    form.set("output_format", String(request.outputFormat));
    form.set("is_demo", request.isDemo === true ? "1" : "0");
    if (request.addOpt1 !== undefined) form.set("add_opt1", request.addOpt1);
    if (request.addOpt2 !== undefined) form.set("add_opt2", request.addOpt2);
    if (request.addOpt3 !== undefined) form.set("add_opt3", request.addOpt3);
    form.set("audiofile", new Blob([new Uint8Array(bytes)], { type: "audio/wav" }), request.inputAudio.filename);

    const response = await this.fetchImpl(new URL("/api/separation/create", this.baseUrl), {
      method: "POST",
      body: form
    });
    const raw = await parseJsonResponse(response);
    const root = objectValue(raw);
    const data = objectValue(root?.data);

    if (root?.success !== true) {
      throw new Error(stringValue(data?.message) ?? "MVSEP separation job creation failed.");
    }

    const hash = stringValue(data?.hash);
    if (hash === undefined) {
      throw new Error("MVSEP separation response did not include a job hash.");
    }

    const link = stringValue(data?.link);
    return {
      hash,
      ...(link === undefined ? {} : { link }),
      raw
    };
  }

  async getResult(hash: string): Promise<MvsepStatusResult> {
    const url = new URL("/api/separation/get", this.baseUrl);
    url.searchParams.set("hash", hash);

    const response = await this.fetchImpl(url);
    const raw = await parseJsonResponse(response);
    const root = objectValue(raw);
    const data = objectValue(root?.data);

    return {
      success: root?.success === true,
      ...(stringValue(root?.status) === undefined ? {} : { status: stringValue(root?.status) as MvsepSeparationStatus }),
      ...(data === undefined ? {} : { data }),
      raw
    };
  }

  async waitForResult(hash: string): Promise<MvsepStatusResult> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const result = await this.getResult(hash);

      if (result.status === "done") {
        return result;
      }

      if (result.status === "failed" || result.status === "not_found" || result.success === false) {
        const message = typeof result.data?.message === "string" ? result.data.message : `MVSEP job ${hash} failed.`;
        throw new Error(message);
      }

      await sleep(this.pollIntervalMs);
    }

    throw new Error(`MVSEP job ${hash} did not complete after ${this.maxPollAttempts} polling attempts.`);
  }
}
