import type { Aiff44100Format, AudioArtifact, ArtifactKind, OpenDawSessionArtifact } from "../../pipeline/types.ts";

let counter = 0;

export const defaultAiffFormat: Aiff44100Format = {
  container: "AIFF",
  sampleRateHz: 44100,
  bitDepth: 16,
  channels: 2
};

export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${String(counter).padStart(4, "0")}`;
}

export function createMockAudioArtifact<const Kind extends AudioArtifact["kind"]>(input: {
  kind: Kind;
  filename: string;
  sourceArtifactIds?: string[];
  durationSeconds?: number | undefined;
  metadata?: Record<string, string | number | boolean>;
}): AudioArtifact & { kind: Kind } {
  return {
    id: nextId(input.kind),
    kind: input.kind,
    uri: `mock://artifacts/${input.filename}`,
    filename: input.filename,
    sourceArtifactIds: input.sourceArtifactIds ?? [],
    metadata: input.metadata ?? {},
    format: defaultAiffFormat,
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
