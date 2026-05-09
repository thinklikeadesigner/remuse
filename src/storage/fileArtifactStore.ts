import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import type { AudioArtifact, InstrumentLabel, MidiArtifact } from "../pipeline/types.ts";
import { assertSupportedWorkflowWav, parseWavFormat } from "../audio/wav.ts";

export type FileArtifactStoreOptions = {
  rootDir: string;
};

export type StoredInputArtifact = {
  artifact: AudioArtifact & { kind: "input-audio" };
  sha256: string;
  path: string;
};

export type StoreAudioArtifactInput<Kind extends AudioArtifact["kind"]> = {
  jobId: string;
  stage: string;
  kind: Kind;
  filename: string;
  bytes: Buffer;
  sourceArtifactIds: string[];
  metadata?: Record<string, string | number | boolean>;
};

export type StoredAudioArtifact<Kind extends AudioArtifact["kind"]> = {
  artifact: AudioArtifact & { kind: Kind };
  sha256: string;
  path: string;
};

export type StoreMidiArtifactInput = {
  jobId: string;
  stage: string;
  filename: string;
  bytes: Buffer;
  sourceArtifactIds: string[];
  instrument: InstrumentLabel;
  metadata?: Record<string, string | number | boolean>;
};

export type StoredMidiArtifact = {
  artifact: MidiArtifact;
  sha256: string;
  path: string;
};

function safeFilename(filename: string, fallback = "input.wav"): string {
  const normalized = filename.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : fallback;
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export class FileArtifactStore {
  readonly rootDir: string;

  constructor(options: FileArtifactStoreOptions) {
    this.rootDir = options.rootDir;
  }

  async saveInputWav(jobId: string, filename: string, bytes: Buffer): Promise<StoredInputArtifact> {
    const parsed = assertSupportedWorkflowWav(bytes);
    const artifactDir = join(this.rootDir, jobId, "input");
    await mkdir(artifactDir, { recursive: true });

    const storedFilename = safeFilename(filename).replace(/\.wav$/i, "") + ".wav";
    const artifactPath = join(artifactDir, storedFilename);
    await writeFile(artifactPath, bytes);

    const digest = sha256(bytes);
    const artifact: AudioArtifact & { kind: "input-audio" } = {
      id: `${jobId}-input`,
      kind: "input-audio",
      uri: pathToFileURL(artifactPath).href,
      filename: storedFilename,
      sourceArtifactIds: [],
      metadata: {
        sha256: digest,
        byteLength: bytes.length,
        dataBytes: parsed.dataBytes
      },
      format: parsed.format,
      ...(parsed.durationSeconds === undefined ? {} : { durationSeconds: parsed.durationSeconds })
    };

    return {
      artifact,
      sha256: digest,
      path: artifactPath
    };
  }

  async saveAudioArtifact<Kind extends AudioArtifact["kind"]>(
    input: StoreAudioArtifactInput<Kind>
  ): Promise<StoredAudioArtifact<Kind>> {
    const parsed = assertCanonicalWavFamily(input.bytes);
    const artifactDir = join(this.rootDir, input.jobId, safeFilename(input.stage));
    await mkdir(artifactDir, { recursive: true });

    const storedFilename = safeFilename(input.filename).replace(/\.wav$/i, "") + ".wav";
    const artifactPath = join(artifactDir, storedFilename);
    await writeFile(artifactPath, input.bytes);

    const digest = sha256(input.bytes);
    const artifact: AudioArtifact & { kind: Kind } = {
      id: `${input.jobId}-${input.kind}-${digest.slice(0, 12)}`,
      kind: input.kind,
      uri: pathToFileURL(artifactPath).href,
      filename: storedFilename,
      sourceArtifactIds: input.sourceArtifactIds,
      metadata: {
        ...(input.metadata ?? {}),
        sha256: digest,
        byteLength: input.bytes.length,
        dataBytes: parsed.dataBytes
      },
      format: parsed.format,
      ...(parsed.durationSeconds === undefined ? {} : { durationSeconds: parsed.durationSeconds })
    };

    return {
      artifact,
      sha256: digest,
      path: artifactPath
    };
  }

  async saveAudioArtifactFromUrl<Kind extends AudioArtifact["kind"]>(
    input: Omit<StoreAudioArtifactInput<Kind>, "bytes"> & { url: string }
  ): Promise<StoredAudioArtifact<Kind>> {
    const response = await fetch(input.url);
    if (!response.ok) {
      throw new Error(`Could not download artifact ${input.url}: ${response.status} ${response.statusText}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    return this.saveAudioArtifact({
      jobId: input.jobId,
      stage: input.stage,
      kind: input.kind,
      filename: input.filename,
      bytes,
      sourceArtifactIds: input.sourceArtifactIds,
      ...(input.metadata === undefined ? {} : { metadata: input.metadata })
    });
  }

  async saveMidiArtifact(input: StoreMidiArtifactInput): Promise<StoredMidiArtifact> {
    const artifactDir = join(this.rootDir, input.jobId, safeFilename(input.stage, "midi"));
    await mkdir(artifactDir, { recursive: true });

    const storedFilename = safeFilename(input.filename, "output.mid").replace(/\.(?:mid|midi)$/i, "") + ".mid";
    const artifactPath = join(artifactDir, storedFilename);
    await writeFile(artifactPath, input.bytes);

    const digest = sha256(input.bytes);
    const artifact: MidiArtifact = {
      id: `${input.jobId}-midi-${digest.slice(0, 12)}`,
      kind: "midi",
      uri: pathToFileURL(artifactPath).href,
      filename: storedFilename,
      sourceArtifactIds: input.sourceArtifactIds,
      metadata: {
        ...(input.metadata ?? {}),
        sha256: digest,
        byteLength: input.bytes.length,
        normalizedInstrument: input.instrument.canonicalName
      },
      instrument: input.instrument
    };

    return {
      artifact,
      sha256: digest,
      path: artifactPath
    };
  }
}

function assertCanonicalWavFamily(buffer: Buffer) {
  return parseWavFormat(buffer);
}
