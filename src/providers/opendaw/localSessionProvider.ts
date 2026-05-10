import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderSessionPreviewBounceWav } from "../../audio/sessionPreviewBounce.ts";
import { fitPcmWavToFrameCount } from "../../audio/wavDuration.ts";
import type {
  BounceResult,
  DiagnosticTrackBounce,
  MidiArtifact,
  OpenDawProvider,
  OpenDawRenderTarget,
  OpenDawSessionArtifact,
  OpenDawSessionResult,
  OpenDawTrackPlan,
  ProviderContext,
  SampleLibraryAssignment
} from "../../pipeline/types.ts";
import type { FileArtifactStore } from "../../storage/fileArtifactStore.ts";
import { renderFluidSynthBounce, type FluidSynthRenderOptions, type FluidSynthRenderResult } from "./fluidSynthRenderer.ts";
import { sampleLibraryForInstrument } from "./sampleLibraries.ts";

export type LocalOpenDawSessionProviderOptions = {
  artifactStore: FileArtifactStore;
  renderBackend?: LocalOpenDawRenderBackendOptions;
};

type SessionTrackDocument = {
  trackId: string;
  trackIndex: number;
  trackName: string;
  midi: {
    artifactId: string;
    filename: string;
    uri: string;
    normalizedInstrument: string;
  };
  sampleLibrary: SampleLibraryAssignment;
  sampleLibraryLoaded: boolean;
};

type ReproducibleSessionDocument = {
  schemaVersion: "remuse.opendaw-session.v1";
  provider: "local-opendaw-session";
  jobId: string;
  sessionId: string;
  sampleRateHz: 44100;
  bitDepth: 16;
  channels: 2;
  tracks: SessionTrackDocument[];
  render: {
    targetFormat: "wav-pcm-16-44100-stereo";
    headlessOpenDawRenderer: false;
    renderMode: "deterministic-preview" | "fluidsynth";
  };
};

export type LocalOpenDawRenderBackendOptions =
  | {
      mode: "preview";
    }
  | ({
      mode: "fluidsynth";
    } & Omit<FluidSynthRenderOptions, "workingDir">);

const providerName = "local-opendaw-session";

function sessionIdForJob(jobId: string): string {
  return `${jobId}-opendaw-session`;
}

function sessionDocument(input: {
  jobId: string;
  sessionId: string;
  tracks: SessionTrackDocument[];
  renderMode?: ReproducibleSessionDocument["render"]["renderMode"];
}): ReproducibleSessionDocument {
  return {
    schemaVersion: "remuse.opendaw-session.v1",
    provider: providerName,
    jobId: input.jobId,
    sessionId: input.sessionId,
    sampleRateHz: 44100,
    bitDepth: 16,
    channels: 2,
    tracks: input.tracks,
    render: {
      targetFormat: "wav-pcm-16-44100-stereo",
      headlessOpenDawRenderer: false,
      renderMode: input.renderMode ?? "deterministic-preview"
    }
  };
}

function serializeSession(document: ReproducibleSessionDocument): Buffer {
  return Buffer.from(JSON.stringify(document, null, 2) + "\n", "utf8");
}

function trackNameFor(midiFile: MidiArtifact, index: number): string {
  return `${String(index + 1).padStart(2, "0")} ${midiFile.instrument.canonicalName}`;
}

function diagnosticTrackFilename(session: OpenDawSessionArtifact, track: SessionTrackDocument): string {
  const sessionPrefix = session.filename.replace(/\.opendaw(?:\.json)?$/i, "");
  const trackNumber = String(track.trackIndex + 1).padStart(2, "0");
  return `${sessionPrefix}.track-${trackNumber}.${track.midi.normalizedInstrument}.diagnostic.wav`;
}

function sessionTrackDocument(sessionId: string, midiFile: MidiArtifact, index: number): SessionTrackDocument {
  const sampleLibrary = sampleLibraryForInstrument(midiFile.instrument);
  return {
    trackId: `${sessionId}-track-${String(index + 1).padStart(2, "0")}`,
    trackIndex: index,
    trackName: trackNameFor(midiFile, index),
    midi: {
      artifactId: midiFile.id,
      filename: midiFile.filename,
      uri: midiFile.uri,
      normalizedInstrument: midiFile.instrument.canonicalName
    },
    sampleLibrary,
    sampleLibraryLoaded: true
  };
}

function trackPlan(track: SessionTrackDocument, midiFile: MidiArtifact): OpenDawTrackPlan {
  return {
    trackId: track.trackId,
    trackIndex: track.trackIndex,
    trackName: track.trackName,
    midiFile,
    sampleLibraryKey: track.sampleLibrary.key,
    sampleLibrary: track.sampleLibrary,
    sampleLibraryLoaded: track.sampleLibraryLoaded
  };
}

function normalizeRenderedWav(bytes: Buffer, renderTarget: OpenDawRenderTarget | undefined): Buffer {
  if (renderTarget?.frameCount === undefined) {
    return bytes;
  }

  return fitPcmWavToFrameCount(bytes, renderTarget.frameCount);
}

function renderTargetMetadata(renderTarget: OpenDawRenderTarget | undefined): Record<string, string | number | boolean> {
  if (renderTarget === undefined) {
    return {};
  }

  return {
    renderDurationNormalized: renderTarget.frameCount !== undefined,
    ...(renderTarget.frameCount === undefined ? {} : { targetFrameCount: renderTarget.frameCount }),
    ...(renderTarget.durationSeconds === undefined ? {} : { targetDurationSeconds: renderTarget.durationSeconds })
  };
}

async function readSessionDocument(session: OpenDawSessionArtifact): Promise<ReproducibleSessionDocument> {
  const url = new URL(session.uri);
  if (url.protocol !== "file:") {
    throw new Error(`Local OpenDAW session provider requires file-backed sessions, received ${session.uri}.`);
  }

  return JSON.parse(await readFile(fileURLToPath(url), "utf8")) as ReproducibleSessionDocument;
}

export class LocalOpenDawSessionProvider implements OpenDawProvider {
  private readonly artifactStore: FileArtifactStore;
  private readonly renderBackend: LocalOpenDawRenderBackendOptions;

  constructor(options: LocalOpenDawSessionProviderOptions) {
    this.artifactStore = options.artifactStore;
    this.renderBackend = options.renderBackend ?? { mode: "preview" };
  }

  async createSession(context: ProviderContext): Promise<OpenDawSessionArtifact> {
    const sessionId = sessionIdForJob(context.jobId);
    const document = sessionDocument({
      jobId: context.jobId,
      sessionId,
      tracks: [],
      renderMode: this.renderBackend.mode === "fluidsynth" ? "fluidsynth" : "deterministic-preview"
    });
    const stored = await this.artifactStore.saveOpenDawSessionArtifact({
      jobId: context.jobId,
      stage: "opendaw-session",
      filename: `${context.jobId}.opendaw.json`,
      bytes: serializeSession(document),
      sourceArtifactIds: [],
      sessionId,
      trackCount: 0,
      metadata: {
        provider: providerName,
        schemaVersion: document.schemaVersion,
        reproducible: true,
        headlessOpenDawRenderer: false
      }
    });

    return stored.artifact;
  }

  async importMidiTracks(
    session: OpenDawSessionArtifact,
    midiFiles: MidiArtifact[],
    context: ProviderContext
  ): Promise<OpenDawSessionResult> {
    const tracks = midiFiles.map((midiFile, index) => sessionTrackDocument(session.sessionId, midiFile, index));
    const document = sessionDocument({
      jobId: context.jobId,
      sessionId: session.sessionId,
      tracks,
      renderMode: this.renderBackend.mode === "fluidsynth" ? "fluidsynth" : "deterministic-preview"
    });
    const stored = await this.artifactStore.saveOpenDawSessionArtifact({
      jobId: context.jobId,
      stage: "opendaw-session",
      filename: `${context.jobId}.opendaw.json`,
      bytes: serializeSession(document),
      sourceArtifactIds: midiFiles.map((file) => file.id),
      sessionId: session.sessionId,
      trackCount: tracks.length,
      metadata: {
        provider: providerName,
        schemaVersion: document.schemaVersion,
        importedMidiFiles: midiFiles.length,
        loadedSampleLibraries: tracks.length,
        reproducible: true,
        headlessOpenDawRenderer: false
      }
    });

    return {
      session: stored.artifact,
      tracks: tracks.map((track, index) => trackPlan(track, midiFiles[index] as MidiArtifact))
    };
  }

  async bounceSession(
    session: OpenDawSessionArtifact,
    context: ProviderContext,
    renderTarget?: OpenDawRenderTarget
  ): Promise<BounceResult> {
    const document = await readSessionDocument(session);
    const renderResult: FluidSynthRenderResult =
      this.renderBackend.mode === "fluidsynth"
        ? await renderFluidSynthBounce({
            sessionId: session.sessionId,
            tracks: document.tracks.map((track) => ({
              trackIndex: track.trackIndex,
              trackName: track.trackName,
              midiFilename: track.midi.filename,
              normalizedInstrument: track.midi.normalizedInstrument,
              midiUri: track.midi.uri,
              sampleLibrary: track.sampleLibrary
            })),
            options: {
              ...this.renderBackend,
              workingDir: join(this.artifactStore.rootDir, context.jobId, "fluidsynth-render")
            }
          })
        : {
            bytes: renderSessionPreviewBounceWav({
              tracks: document.tracks.map((track) => ({
                trackId: track.trackId,
                ...(track.sampleLibrary.midiProgram === undefined ? {} : { midiProgram: track.sampleLibrary.midiProgram }),
                ...(track.sampleLibrary.isPercussion === undefined ? {} : { isPercussion: track.sampleLibrary.isPercussion })
              }))
            }),
            metadata: {
              renderer: "remuse-deterministic-preview",
              renderMode: document.render.renderMode,
              targetFormat: document.render.targetFormat,
              trackCount: document.tracks.length,
              headlessOpenDawRenderer: false
            }
          };
    const diagnosticTrackBounces: DiagnosticTrackBounce[] = [];
    for (const trackRender of renderResult.trackRenders ?? []) {
      const track = document.tracks.find((item) => item.trackIndex === trackRender.trackIndex);
      if (track === undefined) {
        continue;
      }

      const stored = await this.artifactStore.saveAudioArtifact({
        jobId: context.jobId,
        stage: "diagnostic-track-bounces",
        kind: "diagnostic-track-bounce",
        filename: diagnosticTrackFilename(session, track),
        bytes: normalizeRenderedWav(trackRender.bytes, renderTarget),
        sourceArtifactIds: [session.id, track.midi.artifactId],
        metadata: {
          provider: providerName,
          diagnostic: true,
          ...trackRender.metadata,
          midiArtifactId: track.midi.artifactId,
          midiFilename: track.midi.filename,
          ...renderTargetMetadata(renderTarget)
        }
      });

      diagnosticTrackBounces.push({
        trackIndex: track.trackIndex,
        trackName: track.trackName,
        midiArtifactId: track.midi.artifactId,
        midiFilename: track.midi.filename,
        normalizedInstrument: track.midi.normalizedInstrument,
        sampleLibraryKey: track.sampleLibrary.key,
        sampleLibrary: track.sampleLibrary,
        bounce: stored.artifact
      });
    }

    const filename = `${session.filename.replace(/\.opendaw(?:\.json)?$/i, "")}.bounce.wav`;
    const stored = await this.artifactStore.saveAudioArtifact({
      jobId: context.jobId,
      stage: "bounce",
      kind: "stereo-bounce",
      filename,
      bytes: normalizeRenderedWav(renderResult.bytes, renderTarget),
      sourceArtifactIds: [session.id],
      metadata: {
        provider: providerName,
        ...renderResult.metadata,
        targetFormat: document.render.targetFormat,
        headlessOpenDawRenderer: false,
        diagnosticTrackBounceCount: diagnosticTrackBounces.length,
        ...renderTargetMetadata(renderTarget)
      }
    });

    return {
      bounce: stored.artifact,
      session,
      ...(diagnosticTrackBounces.length === 0 ? {} : { diagnosticTrackBounces })
    };
  }
}
