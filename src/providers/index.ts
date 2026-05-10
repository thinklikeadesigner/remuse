import type { PipelineProviders } from "../pipeline/types.ts";
import type { FileArtifactStore } from "../storage/fileArtifactStore.ts";
import type { MidiConversionJobRequest } from "./contracts/externalAudioContracts.ts";
import {
  LalalClient,
  LALAL_MULTISTEM_DEFAULT_STEMS,
  LALAL_MULTISTEM_SUPPORTED_STEMS,
  type LalalExtractionLevel,
  type LalalMultistemStem,
  type LalalSplitter
} from "./lalal/client.ts";
import { LalalInstrumentStemSeparationProvider } from "./lalal/providers.ts";
import { BasicPitchMidiConversionProvider, type BasicPitchModelSerialization } from "./midi/basicPitchMidiConversionProvider.ts";
import { HttpMidiConversionProvider } from "./midi/httpMidiConversionProvider.ts";
import { MockInstrumentStemSeparationProvider } from "./mock/stemSeparationProvider.ts";
import { createMockProviders } from "./mock/index.ts";
import { MvsepClient } from "./mvsep/client.ts";
import { createMvsepProviders, MvsepInstrumentStemSeparationProvider } from "./mvsep/providers.ts";
import { LocalOpenDawSessionProvider, type LocalOpenDawRenderBackendOptions } from "./opendaw/localSessionProvider.ts";
import { ProviderNativeInstrumentIdentificationProvider } from "./providerNativeInstrumentIdentificationProvider.ts";

export type ProviderMode = "mock" | "mvsep";
export type StemProviderMode = "mock" | "mvsep" | "lalal";
export type MidiProviderMode = "mock" | "http" | "basic-pitch";
export type OpenDawProviderMode = "mock" | "local-session";
export type OpenDawRendererMode = "preview" | "fluidsynth";

export type ProviderEnvironment = Record<string, string | undefined>;

export type CreateProvidersFromEnvironmentInput = {
  artifactStore: FileArtifactStore;
  env?: ProviderEnvironment;
};

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected numeric environment value, received "${value}".`);
  }

  return parsed;
}

function booleanFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }

  throw new Error(`Expected boolean environment value, received "${value}".`);
}

function providerModeFromEnv(env: ProviderEnvironment): ProviderMode {
  const mode = env.REMUSE_PROVIDER ?? "mock";
  if (mode !== "mock" && mode !== "mvsep") {
    throw new Error(`Unsupported REMUSE_PROVIDER "${mode}". Expected "mock" or "mvsep".`);
  }

  return mode;
}

function stemProviderModeFromEnv(env: ProviderEnvironment, providerMode: ProviderMode): StemProviderMode {
  const mode = env.REMUSE_STEM_PROVIDER ?? (providerMode === "mvsep" ? "mvsep" : "mock");
  if (mode !== "mock" && mode !== "mvsep" && mode !== "lalal") {
    throw new Error(`Unsupported REMUSE_STEM_PROVIDER "${mode}". Expected "mock", "mvsep", or "lalal".`);
  }

  return mode;
}

function midiProviderModeFromEnv(env: ProviderEnvironment): MidiProviderMode {
  const mode = env.REMUSE_MIDI_PROVIDER ?? "mock";
  if (mode !== "mock" && mode !== "http" && mode !== "basic-pitch") {
    throw new Error(`Unsupported REMUSE_MIDI_PROVIDER "${mode}". Expected "mock", "http", or "basic-pitch".`);
  }

  return mode;
}

function openDawProviderModeFromEnv(env: ProviderEnvironment): OpenDawProviderMode {
  const mode = env.REMUSE_OPENDAW_PROVIDER ?? "local-session";
  if (mode !== "mock" && mode !== "local-session") {
    throw new Error(`Unsupported REMUSE_OPENDAW_PROVIDER "${mode}". Expected "mock" or "local-session".`);
  }

  return mode;
}

function openDawRendererModeFromEnv(env: ProviderEnvironment): OpenDawRendererMode {
  const mode = env.REMUSE_OPENDAW_RENDERER ?? "preview";
  if (mode !== "preview" && mode !== "fluidsynth") {
    throw new Error(`Unsupported REMUSE_OPENDAW_RENDERER "${mode}". Expected "preview" or "fluidsynth".`);
  }

  return mode;
}

function requiredEnv(env: ProviderEnvironment, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`REMUSE_MIDI_PROVIDER=http requires ${name}.`);
  }

  return value;
}

function requiredStemProviderEnv(env: ProviderEnvironment, stemMode: StemProviderMode, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`REMUSE_STEM_PROVIDER=${stemMode} requires ${name}.`);
  }

  return value.trim();
}

function requiredOpenDawRendererEnv(env: ProviderEnvironment, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`REMUSE_OPENDAW_RENDERER=fluidsynth requires ${name}.`);
  }

  return value.trim();
}

function mvsepOutputFormatFromEnv(env: ProviderEnvironment): number {
  const outputFormat = numberFromEnv(env.MVSEP_OUTPUT_FORMAT, 1);
  if (outputFormat !== 1) {
    throw new Error("The MVSEP adapter currently supports only MVSEP_OUTPUT_FORMAT=1 (WAV 16-bit).");
  }

  return outputFormat;
}

function quantizationFromEnv(value: string | undefined): MidiConversionJobRequest["quantization"] | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  if (value === "none" || value === "nearest-1-960" || value === "nearest-1-480" || value === "nearest-1-240") {
    return value;
  }

  throw new Error(`Unsupported MIDI_CONVERSION_QUANTIZATION "${value}".`);
}

function basicPitchModelSerializationFromEnv(value: string | undefined): BasicPitchModelSerialization | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  if (value === "tensorflow") {
    return "tf";
  }

  if (value === "tf" || value === "coreml" || value === "tflite" || value === "onnx") {
    return value;
  }

  throw new Error(`Unsupported BASIC_PITCH_MODEL_SERIALIZATION "${value}".`);
}

function lalalStemFromEnvValue(value: string): LalalMultistemStem {
  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  const alias = normalized === "drums" ? "drum" : normalized;

  if ((LALAL_MULTISTEM_SUPPORTED_STEMS as readonly string[]).includes(alias)) {
    return alias as LalalMultistemStem;
  }

  throw new Error(`Unsupported LALAL_STEM_LIST entry "${value}". Expected one of ${LALAL_MULTISTEM_SUPPORTED_STEMS.join(", ")}.`);
}

function lalalStemListFromEnv(value: string | undefined): readonly LalalMultistemStem[] {
  if (value === undefined || value.trim().length === 0) {
    return LALAL_MULTISTEM_DEFAULT_STEMS;
  }

  const stems = value
    .split(",")
    .map(lalalStemFromEnvValue)
    .filter((item, index, array) => array.indexOf(item) === index);

  if (stems.length === 0) {
    throw new Error("LALAL_STEM_LIST must include at least one stem.");
  }

  return stems;
}

function lalalSplitterFromEnv(value: string | undefined): LalalSplitter {
  if (value === undefined || value.trim().length === 0) {
    return "auto";
  }

  if (value === "auto" || value === "andromeda" || value === "perseus" || value === "orion" || value === "phoenix" || value === "lyra" || value === "lynx") {
    return value;
  }

  throw new Error(`Unsupported LALAL_SPLITTER "${value}".`);
}

function lalalExtractionLevelFromEnv(value: string | undefined): LalalExtractionLevel {
  if (value === undefined || value.trim().length === 0) {
    return "deep_extraction";
  }

  if (value === "deep_extraction" || value === "clear_cut") {
    return value;
  }

  throw new Error(`Unsupported LALAL_EXTRACTION_LEVEL "${value}".`);
}

function assertLalalWavEncoderFormat(value: string | undefined): void {
  if (value !== undefined && value.trim().length > 0 && value.trim() !== "wav") {
    throw new Error("The LALAL.AI adapter currently supports only LALAL_ENCODER_FORMAT=wav because ReMuse expects WAV stems.");
  }
}

function validateLalalSplitterStemCompatibility(stemList: readonly LalalMultistemStem[], splitter: LalalSplitter): void {
  if (splitter === "andromeda" && stemList.includes("piano")) {
    throw new Error("LALAL_SPLITTER=andromeda does not support the piano multistem in LALAL.AI. Use LALAL_SPLITTER=auto or remove piano from LALAL_STEM_LIST.");
  }
}

function withConfiguredStemProvider(
  providers: PipelineProviders,
  artifactStore: FileArtifactStore,
  env: ProviderEnvironment,
  stemMode: StemProviderMode
): PipelineProviders {
  if (stemMode === "mock") {
    return {
      ...providers,
      instrumentStemSeparation: new MockInstrumentStemSeparationProvider()
    };
  }

  if (stemMode === "mvsep") {
    const apiToken = requiredStemProviderEnv(env, "mvsep", "MVSEP_API_TOKEN");
    const outputFormat = mvsepOutputFormatFromEnv(env);
    const client = new MvsepClient({
      apiToken,
      ...(env.MVSEP_BASE_URL === undefined ? {} : { baseUrl: env.MVSEP_BASE_URL }),
      pollIntervalMs: numberFromEnv(env.MVSEP_POLL_INTERVAL_MS, 10_000),
      maxPollAttempts: numberFromEnv(env.MVSEP_MAX_POLL_ATTEMPTS, 120)
    });

    return {
      ...providers,
      instrumentStemSeparation: new MvsepInstrumentStemSeparationProvider(client, artifactStore, outputFormat),
      instrumentIdentification: new ProviderNativeInstrumentIdentificationProvider()
    };
  }

  assertLalalWavEncoderFormat(env.LALAL_ENCODER_FORMAT);
  const stemList = lalalStemListFromEnv(env.LALAL_STEM_LIST);
  const splitter = lalalSplitterFromEnv(env.LALAL_SPLITTER);
  validateLalalSplitterStemCompatibility(stemList, splitter);

  return {
    ...providers,
    instrumentStemSeparation: new LalalInstrumentStemSeparationProvider(
      new LalalClient({
        licenseKey: requiredStemProviderEnv(env, "lalal", "LALAL_LICENSE_KEY"),
        ...(env.LALAL_BASE_URL === undefined ? {} : { baseUrl: env.LALAL_BASE_URL }),
        pollIntervalMs: numberFromEnv(env.LALAL_POLL_INTERVAL_MS, 5_000),
        maxPollAttempts: numberFromEnv(env.LALAL_MAX_POLL_ATTEMPTS, 120)
      }),
      artifactStore,
      {
        stemList,
        splitter,
        extractionLevel: lalalExtractionLevelFromEnv(env.LALAL_EXTRACTION_LEVEL),
        deleteAfterDownload: booleanFromEnv(env.LALAL_DELETE_AFTER_DOWNLOAD, false)
      }
    ),
    instrumentIdentification: new ProviderNativeInstrumentIdentificationProvider()
  };
}

function withConfiguredMidiProvider(
  providers: PipelineProviders,
  artifactStore: FileArtifactStore,
  env: ProviderEnvironment
): PipelineProviders {
  const midiMode = midiProviderModeFromEnv(env);
  if (midiMode === "mock") {
    return providers;
  }

  if (midiMode === "basic-pitch") {
    const modelSerialization = basicPitchModelSerializationFromEnv(env.BASIC_PITCH_MODEL_SERIALIZATION);

    return {
      ...providers,
      midiConversion: new BasicPitchMidiConversionProvider({
        artifactStore,
        ...(env.BASIC_PITCH_COMMAND === undefined || env.BASIC_PITCH_COMMAND.trim().length === 0
          ? {}
          : { command: env.BASIC_PITCH_COMMAND.trim() }),
        ...(modelSerialization === undefined ? {} : { modelSerialization })
      })
    };
  }

  const quantization = quantizationFromEnv(env.MIDI_CONVERSION_QUANTIZATION);
  const callbackUrl = env.MIDI_CONVERSION_CALLBACK_URL?.trim();

  return {
    ...providers,
    midiConversion: new HttpMidiConversionProvider({
      artifactStore,
      baseUrl: requiredEnv(env, "MIDI_CONVERSION_BASE_URL"),
      apiToken: requiredEnv(env, "MIDI_CONVERSION_API_TOKEN"),
      pollIntervalMs: numberFromEnv(env.MIDI_CONVERSION_POLL_INTERVAL_MS, 10_000),
      maxPollAttempts: numberFromEnv(env.MIDI_CONVERSION_MAX_POLL_ATTEMPTS, 120),
      ...(quantization === undefined ? {} : { quantization }),
      ...(callbackUrl === undefined || callbackUrl.length === 0 ? {} : { callbackUrl })
    })
  };
}

function withConfiguredOpenDawProvider(
  providers: PipelineProviders,
  artifactStore: FileArtifactStore,
  env: ProviderEnvironment
): PipelineProviders {
  const opendawMode = openDawProviderModeFromEnv(env);
  if (opendawMode === "mock") {
    return providers;
  }

  const rendererMode = openDawRendererModeFromEnv(env);
  const renderBackend: LocalOpenDawRenderBackendOptions =
    rendererMode === "fluidsynth"
      ? {
          mode: "fluidsynth",
          soundfontPath: requiredOpenDawRendererEnv(env, "REMUSE_FLUIDSYNTH_SOUNDFONT"),
          ...(env.REMUSE_FLUIDSYNTH_COMMAND === undefined || env.REMUSE_FLUIDSYNTH_COMMAND.trim().length === 0
            ? {}
            : { command: env.REMUSE_FLUIDSYNTH_COMMAND.trim() }),
          timeoutMs: numberFromEnv(env.REMUSE_FLUIDSYNTH_TIMEOUT_MS, 5 * 60 * 1000),
          renderTrackDiagnostics: booleanFromEnv(env.REMUSE_FLUIDSYNTH_TRACK_DIAGNOSTICS, false)
        }
      : { mode: "preview" };

  return {
    ...providers,
    opendaw: new LocalOpenDawSessionProvider({ artifactStore, renderBackend })
  };
}

export function createProvidersFromEnvironment(input: CreateProvidersFromEnvironmentInput): PipelineProviders {
  const env = input.env ?? process.env;
  const mode = providerModeFromEnv(env);
  const stemMode = stemProviderModeFromEnv(env, mode);
  const midiMode = midiProviderModeFromEnv(env);

  if (midiMode === "basic-pitch" && stemMode === "mock") {
    throw new Error(
      "REMUSE_MIDI_PROVIDER=basic-pitch requires local file-backed stems. Use REMUSE_PROVIDER=mvsep, REMUSE_STEM_PROVIDER=lalal, or npm run demo:basic-pitch."
    );
  }

  if (mode === "mock") {
    return withConfiguredOpenDawProvider(
      withConfiguredMidiProvider(withConfiguredStemProvider(createMockProviders(), input.artifactStore, env, stemMode), input.artifactStore, env),
      input.artifactStore,
      env
    );
  }

  const apiToken = env.MVSEP_API_TOKEN;
  if (apiToken === undefined || apiToken.trim().length === 0) {
    throw new Error("REMUSE_PROVIDER=mvsep requires MVSEP_API_TOKEN.");
  }

  const outputFormat = mvsepOutputFormatFromEnv(env);

  return withConfiguredOpenDawProvider(
    withConfiguredMidiProvider(
      withConfiguredStemProvider(
        createMvsepProviders({
          artifactStore: input.artifactStore,
          apiToken,
          ...(env.MVSEP_BASE_URL === undefined ? {} : { baseUrl: env.MVSEP_BASE_URL }),
          outputFormat,
          pollIntervalMs: numberFromEnv(env.MVSEP_POLL_INTERVAL_MS, 10_000),
          maxPollAttempts: numberFromEnv(env.MVSEP_MAX_POLL_ATTEMPTS, 120)
        }),
        input.artifactStore,
        env,
        stemMode
      ),
      input.artifactStore,
      env
    ),
    input.artifactStore,
    env
  );
}
