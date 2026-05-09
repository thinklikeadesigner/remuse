import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import type { AudioArtifact } from "../pipeline/types.ts";
import { assertCanonicalInternalWav } from "../audio/wav.ts";

export type FileArtifactStoreOptions = {
  rootDir: string;
};

export type StoredInputArtifact = {
  artifact: AudioArtifact & { kind: "input-audio" };
  sha256: string;
  path: string;
};

function safeFilename(filename: string): string {
  const normalized = filename.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : "input.wav";
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
    const parsed = assertCanonicalInternalWav(bytes);
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
}
