import type {
  DereverbProvider,
  DereverbResult,
  InstrumentStem,
  InstrumentStemSeparationProvider,
  PipelineProviders,
  ProviderContext
} from "../../pipeline/types.ts";
import { renderResidualReverbWav } from "../../audio/residual.ts";
import { normalizeInstrumentName } from "../../pipeline/naming.ts";
import type { FileArtifactStore } from "../../storage/fileArtifactStore.ts";
import { createMockProviders } from "../mock/index.ts";
import { ProviderNativeInstrumentIdentificationProvider } from "../providerNativeInstrumentIdentificationProvider.ts";
import { MvsepClient, readArtifactBytes } from "./client.ts";
import {
  extractMvsepFiles,
  normalizeMvsepStemLabel,
  selectDereverbFiles,
  sortMvsepStemFiles,
  type MvsepFileRef
} from "./normalization.ts";

export type MvsepProviderOptions = {
  artifactStore: FileArtifactStore;
  apiToken: string;
  baseUrl?: string;
  outputFormat?: number;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
};

export const MVSEP_DEREVERB_SEP_TYPE = 22;
export const MVSEP_DEREVERB_MODEL_TYPE = "0";
export const MVSEP_DEREVERB_PREPROCESS_MODE = "1";
export const MVSEP_INSTRUMENT_STEM_SEP_TYPE = 63;
export const MVSEP_INSTRUMENT_STEM_ALGORITHM_NAME = "BS Roformer SW";
export const MVSEP_INSTRUMENT_STEM_MAX_OUTPUT_FILES = 7;
const defaultOutputFormat = 1;

function nowIso(): string {
  return new Date().toISOString();
}

function baseName(filename: string): string {
  return filename.replace(/\.[a-z0-9]+$/i, "");
}

function providerFileMetadata(file: MvsepFileRef, providerJobId: string): Record<string, string | number | boolean> {
  return {
    provider: "mvsep",
    providerJobId,
    providerFilename: file.filename,
    providerLabel: file.label,
    providerUrl: file.url
  };
}

export class MvsepDereverbProvider implements DereverbProvider {
  private readonly client: MvsepClient;
  private readonly artifactStore: FileArtifactStore;
  private readonly outputFormat: number;

  constructor(client: MvsepClient, artifactStore: FileArtifactStore, outputFormat = defaultOutputFormat) {
    this.client = client;
    this.artifactStore = artifactStore;
    this.outputFormat = outputFormat;
  }

  async splitReverb(input: Parameters<DereverbProvider["splitReverb"]>[0], context: ProviderContext): Promise<DereverbResult> {
    const created = await this.client.createSeparation({
      inputAudio: input,
      sepType: MVSEP_DEREVERB_SEP_TYPE,
      addOpt1: MVSEP_DEREVERB_MODEL_TYPE,
      addOpt2: MVSEP_DEREVERB_PREPROCESS_MODE,
      outputFormat: this.outputFormat
    });
    await context.emit({
      step: "de-reverb",
      status: "running",
      message: `MVSEP de-reverb job ${created.hash} queued.`,
      at: nowIso()
    });

    const result = await this.client.waitForResult(created.hash);
    const selected = selectDereverbFiles(extractMvsepFiles(result.raw, this.client.baseUrl));

    if (selected.dryOnly === undefined) {
      throw new Error(`MVSEP de-reverb job ${created.hash} did not return a dry/no-reverb artifact.`);
    }

    const dryOnly = await this.artifactStore.saveAudioArtifactFromUrl({
      jobId: context.jobId,
      stage: "dereverb",
      kind: "dry-audio",
      filename: `${baseName(input.filename)}.dry-only.wav`,
      url: selected.dryOnly.url,
      sourceArtifactIds: [input.id],
      metadata: providerFileMetadata(selected.dryOnly, created.hash)
    });
    const reverbOnly =
      selected.reverbOnly === undefined
        ? await this.artifactStore.saveAudioArtifact({
            jobId: context.jobId,
            stage: "dereverb",
            kind: "reverb-audio",
            filename: `${baseName(input.filename)}.reverb-only.wav`,
            bytes: renderResidualReverbWav(await readArtifactBytes(input), await readArtifactBytes(dryOnly.artifact)),
            sourceArtifactIds: [input.id, dryOnly.artifact.id],
            metadata: {
              provider: "remuse-local-residual",
              providerJobId: created.hash,
              providerNative: false,
              residualFormula: "original-minus-dry"
            }
          })
        : await this.artifactStore.saveAudioArtifactFromUrl({
            jobId: context.jobId,
            stage: "dereverb",
            kind: "reverb-audio",
            filename: `${baseName(input.filename)}.reverb-only.wav`,
            url: selected.reverbOnly.url,
            sourceArtifactIds: [input.id],
            metadata: providerFileMetadata(selected.reverbOnly, created.hash)
          });

    return {
      dryOnly: dryOnly.artifact,
      reverbOnly: reverbOnly.artifact
    };
  }
}

export class MvsepInstrumentStemSeparationProvider implements InstrumentStemSeparationProvider {
  private readonly client: MvsepClient;
  private readonly artifactStore: FileArtifactStore;
  private readonly outputFormat: number;

  constructor(client: MvsepClient, artifactStore: FileArtifactStore, outputFormat = defaultOutputFormat) {
    this.client = client;
    this.artifactStore = artifactStore;
    this.outputFormat = outputFormat;
  }

  async separateInstruments(
    sourceAudio: Parameters<InstrumentStemSeparationProvider["separateInstruments"]>[0],
    context: ProviderContext
  ): Promise<InstrumentStem[]> {
    const created = await this.client.createSeparation({
      inputAudio: sourceAudio,
      sepType: MVSEP_INSTRUMENT_STEM_SEP_TYPE,
      outputFormat: this.outputFormat
    });
    await context.emit({
      step: "instrument-stem-separation",
      status: "running",
      message: `MVSEP ${MVSEP_INSTRUMENT_STEM_ALGORITHM_NAME} instrument stem job ${created.hash} queued.`,
      at: nowIso()
    });

    const result = await this.client.waitForResult(created.hash);
    const files = sortMvsepStemFiles(extractMvsepFiles(result.raw, this.client.baseUrl));

    if (files.length === 0) {
      throw new Error(`MVSEP instrument stem job ${created.hash} did not return any stem artifacts.`);
    }
    if (files.length > MVSEP_INSTRUMENT_STEM_MAX_OUTPUT_FILES) {
      throw new Error(
        `MVSEP ${MVSEP_INSTRUMENT_STEM_ALGORITHM_NAME} job ${created.hash} returned ${files.length} stem artifacts; expected at most ${MVSEP_INSTRUMENT_STEM_MAX_OUTPUT_FILES}.`
      );
    }

    const stems: InstrumentStem[] = [];
    for (const [index, file] of files.entries()) {
      const preliminaryId = `${context.jobId}-mvsep-stem-${index}`;
      const label = normalizeMvsepStemLabel({
        providerLabel: file.label,
        filename: file.filename,
        detectedFromArtifactId: preliminaryId
      });
      const saved = await this.artifactStore.saveAudioArtifactFromUrl({
        jobId: context.jobId,
        stage: "instrument-stems",
        kind: "instrument-stem",
        filename: `${baseName(sourceAudio.filename)}.stem-${String(index + 1).padStart(2, "0")}.${normalizeInstrumentName(label.canonicalName)}.wav`,
        url: file.url,
        sourceArtifactIds: [sourceAudio.id],
        metadata: {
          ...providerFileMetadata(file, created.hash),
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

    return stems;
  }
}

export function createMvsepProviders(options: MvsepProviderOptions): PipelineProviders {
  const client = new MvsepClient({
    apiToken: options.apiToken,
    ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
    ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    ...(options.maxPollAttempts === undefined ? {} : { maxPollAttempts: options.maxPollAttempts })
  });
  const outputFormat = options.outputFormat ?? defaultOutputFormat;
  const fallbackProviders = createMockProviders();

  return {
    dereverb: new MvsepDereverbProvider(client, options.artifactStore, outputFormat),
    instrumentStemSeparation: new MvsepInstrumentStemSeparationProvider(client, options.artifactStore, outputFormat),
    instrumentIdentification: new ProviderNativeInstrumentIdentificationProvider(),
    midiConversion: fallbackProviders.midiConversion,
    opendaw: fallbackProviders.opendaw
  };
}
