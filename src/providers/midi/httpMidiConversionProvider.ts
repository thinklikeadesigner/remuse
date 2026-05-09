import { makeMidiFilename } from "../../pipeline/naming.ts";
import type {
  AudioArtifact,
  InstrumentLabel,
  InstrumentStem,
  MidiArtifact,
  MidiConversionProvider,
  MidiConversionResult,
  ProviderContext
} from "../../pipeline/types.ts";
import type { FileArtifactStore } from "../../storage/fileArtifactStore.ts";
import type {
  MidiConversionJobRequest,
  MidiConversionJobResult,
  ProviderAsyncJobAccepted,
  ProviderAudioArtifactRef,
  ProviderInstrumentLabel,
  ProviderProcessingError
} from "../contracts/externalAudioContracts.ts";

export type HttpMidiConversionProviderOptions = {
  artifactStore: FileArtifactStore;
  baseUrl: string;
  apiToken: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  quantization?: MidiConversionJobRequest["quantization"];
  callbackUrl?: string;
  fetchImpl?: typeof fetch;
};

const defaultPollIntervalMs = 10_000;
const defaultMaxPollAttempts = 120;
const providerName = "http-midi-conversion";

type PreparedStem = {
  item: InstrumentStem & { label: InstrumentLabel };
  stemIndex: number;
  outputFilename: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stringMetadata(value: string | number | boolean | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function providerInstrumentLabel(label: InstrumentLabel): ProviderInstrumentLabel {
  const method = label.method === "mock" ? "filename-hint" : label.method;

  return {
    canonicalName: label.canonicalName,
    family: label.family,
    confidence: label.confidence,
    method,
    ...(label.midiProgram === undefined ? {} : { midiProgram: label.midiProgram }),
    ...(label.sampleLibraryKey === undefined ? {} : { sampleLibraryKey: label.sampleLibraryKey })
  };
}

function audioArtifactRef(artifact: AudioArtifact): ProviderAudioArtifactRef {
  const sha256 = stringMetadata(artifact.metadata.sha256);
  if (sha256 === undefined) {
    throw new Error(`Audio artifact ${artifact.id} is missing sha256 metadata required for external MIDI conversion.`);
  }

  return {
    artifactId: artifact.id,
    url: artifact.uri,
    filename: artifact.filename,
    mediaType: "audio/wav",
    sha256,
    format: artifact.format,
    ...(artifact.durationSeconds === undefined ? {} : { durationSeconds: artifact.durationSeconds })
  };
}

function errorMessage(error: ProviderProcessingError | undefined, fallback: string): string {
  if (error === undefined) {
    return fallback;
  }

  return `${error.code}: ${error.message}${error.retryable ? " (retryable)" : ""}`;
}

async function parseJsonResponse<T>(response: Response, operation: string): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${operation} failed: ${response.status} ${response.statusText}${text.length > 0 ? `: ${text}` : ""}`);
  }

  return JSON.parse(text) as T;
}

function midiDownloadUrl(url: string, baseUrl: string): URL {
  return new URL(url, baseUrl);
}

export class HttpMidiConversionProvider implements MidiConversionProvider {
  private readonly artifactStore: FileArtifactStore;
  private readonly baseUrl: string;
  private readonly apiToken: string;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private readonly quantization: MidiConversionJobRequest["quantization"] | undefined;
  private readonly callbackUrl: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpMidiConversionProviderOptions) {
    this.artifactStore = options.artifactStore;
    this.baseUrl = options.baseUrl;
    this.apiToken = options.apiToken;
    this.pollIntervalMs = options.pollIntervalMs ?? defaultPollIntervalMs;
    this.maxPollAttempts = options.maxPollAttempts ?? defaultMaxPollAttempts;
    this.quantization = options.quantization;
    this.callbackUrl = options.callbackUrl;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async convertStemsToMidi(stems: Array<InstrumentStem & { label: InstrumentLabel }>, context: ProviderContext): Promise<MidiConversionResult> {
    const prepared = stems.map((item, index): PreparedStem => {
      return {
        item,
        stemIndex: index,
        outputFilename: makeMidiFilename(context.jobId, item.label, index)
      };
    });
    const accepted = await this.createJob(this.createRequest(context.jobId, prepared));
    await context.emit({
      step: "midi-conversion",
      status: "running",
      message: `External MIDI conversion job ${accepted.providerJobId} queued.`,
      at: new Date().toISOString()
    });

    const result = await this.waitForResult(accepted);
    return {
      midiFiles: await this.persistMidiFiles(context.jobId, prepared, result)
    };
  }

  private createRequest(jobId: string, prepared: PreparedStem[]): MidiConversionJobRequest {
    return {
      remuseJobId: jobId,
      stems: prepared.map((entry) => ({
        stemIndex: entry.stemIndex,
        audio: audioArtifactRef(entry.item.stem),
        label: providerInstrumentLabel(entry.item.label),
        outputFilename: entry.outputFilename
      })),
      midiFormat: 1,
      ...(this.quantization === undefined ? {} : { quantization: this.quantization }),
      ...(this.callbackUrl === undefined ? {} : { callbackUrl: this.callbackUrl })
    };
  }

  private async createJob(request: MidiConversionJobRequest): Promise<ProviderAsyncJobAccepted> {
    const response = await this.fetchImpl(new URL("/v1/midi-conversion/jobs", this.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `remuse-${request.remuseJobId}-midi-conversion`
      },
      body: JSON.stringify(request)
    });
    const accepted = await parseJsonResponse<ProviderAsyncJobAccepted>(response, "MIDI conversion job creation");
    if (accepted.status !== "accepted") {
      throw new Error(`MIDI conversion job creation returned unexpected status "${accepted.status}".`);
    }

    return accepted;
  }

  private async getJob(statusUrl: string): Promise<MidiConversionJobResult> {
    const response = await this.fetchImpl(new URL(statusUrl, this.baseUrl), {
      headers: {
        Authorization: `Bearer ${this.apiToken}`
      }
    });

    return parseJsonResponse<MidiConversionJobResult>(response, "MIDI conversion job status");
  }

  private async waitForResult(accepted: ProviderAsyncJobAccepted): Promise<MidiConversionJobResult> {
    for (let attempt = 0; attempt < this.maxPollAttempts; attempt += 1) {
      const result = await this.getJob(accepted.statusUrl);

      if (result.status === "succeeded") {
        if ((result.midiFiles ?? []).length === 0) {
          throw new Error(`MIDI conversion job ${accepted.providerJobId} succeeded without MIDI files.`);
        }

        return result;
      }

      if (result.status === "failed" || result.status === "canceled") {
        throw new Error(errorMessage(result.error, `MIDI conversion job ${accepted.providerJobId} ${result.status}.`));
      }

      await sleep(this.pollIntervalMs);
    }

    throw new Error(`MIDI conversion job ${accepted.providerJobId} did not complete after ${this.maxPollAttempts} polling attempts.`);
  }

  private async persistMidiFiles(jobId: string, prepared: PreparedStem[], result: MidiConversionJobResult): Promise<MidiArtifact[]> {
    const files = [...(result.midiFiles ?? [])].sort((left, right) => left.stemIndex - right.stemIndex);
    const filesByStemIndex = new Map(files.map((file) => [file.stemIndex, file]));

    if (filesByStemIndex.size !== files.length) {
      throw new Error(`MIDI conversion job ${result.providerJobId} returned duplicate stem indexes.`);
    }

    for (const entry of prepared) {
      if (!filesByStemIndex.has(entry.stemIndex)) {
        throw new Error(`MIDI conversion job ${result.providerJobId} did not return MIDI for stem index ${entry.stemIndex}.`);
      }
    }

    const midiFiles: MidiArtifact[] = [];
    for (const entry of prepared) {
      const providerFile = filesByStemIndex.get(entry.stemIndex);
      if (providerFile === undefined) {
        throw new Error(`MIDI conversion job ${result.providerJobId} did not return MIDI for stem index ${entry.stemIndex}.`);
      }

      const bytes = await this.downloadMidi(providerFile.midi.url);
      const saved = await this.artifactStore.saveMidiArtifact({
        jobId,
        stage: "midi",
        filename: entry.outputFilename,
        bytes,
        sourceArtifactIds: [entry.item.stem.id],
        instrument: entry.item.label,
        metadata: {
          provider: providerName,
          providerJobId: result.providerJobId,
          providerArtifactId: providerFile.midi.artifactId,
          providerFilename: providerFile.midi.filename,
          providerUrl: providerFile.midi.url,
          providerInstrument: providerFile.label.canonicalName,
          providerInstrumentConfidence: providerFile.label.confidence,
          stemIndex: entry.stemIndex,
          sourceStem: entry.item.stem.filename,
          midiFormat: providerFile.midi.midiFormat,
          ticksPerQuarter: providerFile.midi.ticksPerQuarter
        }
      });

      midiFiles.push(saved.artifact);
    }

    return midiFiles;
  }

  private async downloadMidi(url: string): Promise<Buffer> {
    const response = await this.fetchImpl(midiDownloadUrl(url, this.baseUrl));
    if (!response.ok) {
      throw new Error(`Could not download MIDI artifact ${url}: ${response.status} ${response.statusText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }
}
