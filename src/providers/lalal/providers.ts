import type { InstrumentLabel, InstrumentStem, InstrumentStemSeparationProvider, ProviderContext } from "../../pipeline/types.ts";
import { inferInstrumentLabel, normalizeInstrumentName } from "../../pipeline/naming.ts";
import type { FileArtifactStore } from "../../storage/fileArtifactStore.ts";
import {
  LalalClient,
  LALAL_MULTISTEM_DEFAULT_STEMS,
  LALAL_MULTISTEM_MAX_OUTPUT_FILES,
  type LalalExtractionLevel,
  type LalalMultistemStem,
  type LalalSplitTrack,
  type LalalSplitter
} from "./client.ts";

export type LalalInstrumentStemSeparationProviderOptions = {
  stemList?: readonly LalalMultistemStem[];
  splitter?: LalalSplitter;
  extractionLevel?: LalalExtractionLevel;
  deleteAfterDownload?: boolean;
};

const defaultSplitter: LalalSplitter = "auto";
const defaultExtractionLevel: LalalExtractionLevel = "deep_extraction";

function nowIso(): string {
  return new Date().toISOString();
}

function baseName(filename: string): string {
  return filename.replace(/\.[a-z0-9]+$/i, "");
}

function labelForLalalTrack(track: LalalSplitTrack, detectedFromArtifactId: string): InstrumentLabel {
  if (track.type === "back" && normalizeInstrumentName(track.label) === "no-multistem") {
    return {
      canonicalName: "other",
      family: "unknown",
      confidence: 0.45,
      detectedFromArtifactId,
      method: "provider-native"
    };
  }

  return inferInstrumentLabel({
    providerLabel: track.label.replace(/_/g, " "),
    filename: track.name ?? undefined,
    detectedFromArtifactId,
    method: "provider-native"
  });
}

function providerTrackMetadata(input: {
  track: LalalSplitTrack;
  sourceId: string;
  taskId: string;
  stemList: readonly LalalMultistemStem[];
  splitter: LalalSplitter;
  extractionLevel: LalalExtractionLevel;
}): Record<string, string | number | boolean> {
  return {
    provider: "lalal",
    providerSourceId: input.sourceId,
    providerTaskId: input.taskId,
    providerTrackType: input.track.type,
    providerLabel: input.track.label,
    providerUrl: input.track.url,
    providerStemList: input.stemList.join(","),
    providerSplitter: input.splitter,
    providerExtractionLevel: input.extractionLevel
  };
}

export class LalalInstrumentStemSeparationProvider implements InstrumentStemSeparationProvider {
  private readonly client: LalalClient;
  private readonly artifactStore: FileArtifactStore;
  private readonly stemList: readonly LalalMultistemStem[];
  private readonly splitter: LalalSplitter;
  private readonly extractionLevel: LalalExtractionLevel;
  private readonly deleteAfterDownload: boolean;

  constructor(client: LalalClient, artifactStore: FileArtifactStore, options: LalalInstrumentStemSeparationProviderOptions = {}) {
    this.client = client;
    this.artifactStore = artifactStore;
    this.stemList = options.stemList ?? LALAL_MULTISTEM_DEFAULT_STEMS;
    this.splitter = options.splitter ?? defaultSplitter;
    this.extractionLevel = options.extractionLevel ?? defaultExtractionLevel;
    this.deleteAfterDownload = options.deleteAfterDownload ?? false;
  }

  async separateInstruments(
    sourceAudio: Parameters<InstrumentStemSeparationProvider["separateInstruments"]>[0],
    context: ProviderContext
  ): Promise<InstrumentStem[]> {
    const upload = await this.client.uploadAudio(sourceAudio);
    await context.emit({
      step: "instrument-stem-separation",
      status: "running",
      message: `LALAL.AI uploaded ${sourceAudio.filename} as source ${upload.id}.`,
      at: nowIso()
    });

    const task = await this.client.createMultistemSplit({
      sourceId: upload.id,
      stemList: this.stemList,
      splitter: this.splitter,
      extractionLevel: this.extractionLevel,
      encoderFormat: "wav",
      dereverbEnabled: false
    });
    await context.emit({
      step: "instrument-stem-separation",
      status: "running",
      message: `LALAL.AI multistem job ${task.taskId} queued.`,
      at: nowIso()
    });

    const result = await this.client.waitForResult(task.taskId);
    const tracks = result.tracks.filter((track) => track.url.trim().length > 0);

    if (tracks.length === 0) {
      throw new Error(`LALAL.AI multistem job ${task.taskId} did not return any stem artifacts.`);
    }

    if (tracks.length > LALAL_MULTISTEM_MAX_OUTPUT_FILES) {
      throw new Error(
        `LALAL.AI multistem job ${task.taskId} returned ${tracks.length} stem artifacts; expected at most ${LALAL_MULTISTEM_MAX_OUTPUT_FILES}.`
      );
    }

    const stems: InstrumentStem[] = [];
    for (const [index, track] of tracks.entries()) {
      const preliminaryId = `${context.jobId}-lalal-stem-${index}`;
      const label = labelForLalalTrack(track, preliminaryId);
      const saved = await this.artifactStore.saveAudioArtifactFromUrl({
        jobId: context.jobId,
        stage: "instrument-stems",
        kind: "instrument-stem",
        filename: `${baseName(sourceAudio.filename)}.stem-${String(index + 1).padStart(2, "0")}.${normalizeInstrumentName(label.canonicalName)}.wav`,
        url: track.url,
        sourceArtifactIds: [sourceAudio.id],
        metadata: {
          ...providerTrackMetadata({
            track,
            sourceId: upload.id,
            taskId: task.taskId,
            stemList: this.stemList,
            splitter: this.splitter,
            extractionLevel: this.extractionLevel
          }),
          stemIndex: index,
          normalizedInstrument: label.canonicalName
        }
      });

      stems.push({
        stem: saved.artifact,
        label: {
          ...label,
          detectedFromArtifactId: saved.artifact.id
        }
      });
    }

    if (this.deleteAfterDownload) {
      await this.client.deleteSource(upload.id);
    }

    return stems;
  }
}
