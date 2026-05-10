import type { PipelineProviders } from "../pipeline/types.ts";
import type { FileArtifactStore } from "../storage/fileArtifactStore.ts";
import type { MidiConversionJobRequest } from "./contracts/externalAudioContracts.ts";
import { BasicPitchMidiConversionProvider, type BasicPitchModelSerialization } from "./midi/basicPitchMidiConversionProvider.ts";
import { HttpMidiConversionProvider } from "./midi/httpMidiConversionProvider.ts";
import { createMockProviders } from "./mock/index.ts";
import { createMvsepProviders } from "./mvsep/providers.ts";
import { LocalOpenDawSessionProvider, type LocalOpenDawRenderBackendOptions } from "./opendaw/localSessionProvider.ts";

export type ProviderMode = "mock" | "mvsep";
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

function providerModeFromEnv(env: ProviderEnvironment): ProviderMode {
  const mode = env.REMUSE_PROVIDER ?? "mock";
  if (mode !== "mock" && mode !== "mvsep") {
    throw new Error(`Unsupported REMUSE_PROVIDER "${mode}". Expected "mock" or "mvsep".`);
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

function requiredOpenDawRendererEnv(env: ProviderEnvironment, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`REMUSE_OPENDAW_RENDERER=fluidsynth requires ${name}.`);
  }

  return value.trim();
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
          timeoutMs: numberFromEnv(env.REMUSE_FLUIDSYNTH_TIMEOUT_MS, 5 * 60 * 1000)
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
  const midiMode = midiProviderModeFromEnv(env);

  if (mode === "mock") {
    if (midiMode === "basic-pitch") {
      throw new Error("REMUSE_MIDI_PROVIDER=basic-pitch requires local file-backed stems. Use REMUSE_PROVIDER=mvsep or npm run demo:basic-pitch.");
    }

    return withConfiguredOpenDawProvider(
      withConfiguredMidiProvider(createMockProviders(), input.artifactStore, env),
      input.artifactStore,
      env
    );
  }

  const apiToken = env.MVSEP_API_TOKEN;
  if (apiToken === undefined || apiToken.trim().length === 0) {
    throw new Error("REMUSE_PROVIDER=mvsep requires MVSEP_API_TOKEN.");
  }

  const outputFormat = numberFromEnv(env.MVSEP_OUTPUT_FORMAT, 1);
  if (outputFormat !== 1) {
    throw new Error("The MVSEP adapter currently supports only MVSEP_OUTPUT_FORMAT=1 (WAV 16-bit).");
  }

  return withConfiguredOpenDawProvider(
    withConfiguredMidiProvider(
      createMvsepProviders({
        artifactStore: input.artifactStore,
        apiToken,
        ...(env.MVSEP_BASE_URL === undefined ? {} : { baseUrl: env.MVSEP_BASE_URL }),
        outputFormat,
        pollIntervalMs: numberFromEnv(env.MVSEP_POLL_INTERVAL_MS, 10_000),
        maxPollAttempts: numberFromEnv(env.MVSEP_MAX_POLL_ATTEMPTS, 120)
      }),
      input.artifactStore,
      env
    ),
    input.artifactStore,
    env
  );
}
