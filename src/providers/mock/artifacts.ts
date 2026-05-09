import type { AudioArtifact, AudioFormat, ArtifactKind, OpenDawSessionArtifact } from "../../pipeline/types.ts";
import { CANONICAL_INTERNAL_WAV_FORMAT, FINAL_OUTPUT_WAV_FORMAT } from "../../pipeline/formats.ts";

let counter = 0;

export const canonicalInternalWavFormat: AudioFormat = CANONICAL_INTERNAL_WAV_FORMAT;
export const finalOutputWavFormat: AudioFormat = FINAL_OUTPUT_WAV_FORMAT;

export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${String(counter).padStart(4, "0")}`;
}

export function createMockAudioArtifact<const Kind extends AudioArtifact["kind"]>(input: {
  kind: Kind;
  filename: string;
  sourceArtifactIds?: string[];
  durationSeconds?: number | undefined;
  format?: AudioFormat;
  metadata?: Record<string, string | number | boolean>;
}): AudioArtifact & { kind: Kind } {
  return {
    id: nextId(input.kind),
    kind: input.kind,
    uri: `mock://artifacts/${input.filename}`,
    filename: input.filename,
    sourceArtifactIds: input.sourceArtifactIds ?? [],
    metadata: input.metadata ?? {},
    format: input.format ?? canonicalInternalWavFormat,
    ...(input.durationSeconds === undefined ? {} : { durationSeconds: input.durationSeconds })
  };
}

export function createMockSessionArtifact(jobId: string, trackCount: number): OpenDawSessionArtifact {
  const sessionId = nextId("opendaw-session");

  return {
    id: sessionId,
    kind: "opendaw-session",
    uri: `mock://opendaw/${jobId}/${sessionId}.opendaw`,
    filename: `${jobId}.opendaw`,
    sourceArtifactIds: [],
    metadata: {
      provider: "mock-opendaw"
    },
    sessionId,
    trackCount
  };
}

export function createMockArtifactUri(kind: ArtifactKind, filename: string): string {
  return `mock://${kind}/${filename}`;
}
