import type { PipelineProviders } from "../pipeline/types.ts";
import type { FileArtifactStore } from "../storage/fileArtifactStore.ts";
import { createMockProviders } from "./mock/index.ts";
import { createMvsepProviders } from "./mvsep/providers.ts";

export type ProviderMode = "mock" | "mvsep";

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

export function createProvidersFromEnvironment(input: CreateProvidersFromEnvironmentInput): PipelineProviders {
  const env = input.env ?? process.env;
  const mode = providerModeFromEnv(env);

  if (mode === "mock") {
    return createMockProviders();
  }

  const apiToken = env.MVSEP_API_TOKEN;
  if (apiToken === undefined || apiToken.trim().length === 0) {
    throw new Error("REMUSE_PROVIDER=mvsep requires MVSEP_API_TOKEN.");
  }

  const outputFormat = numberFromEnv(env.MVSEP_OUTPUT_FORMAT, 1);
  if (outputFormat !== 1) {
    throw new Error("The MVSEP adapter currently supports only MVSEP_OUTPUT_FORMAT=1 (WAV 16-bit).");
  }

  return createMvsepProviders({
    artifactStore: input.artifactStore,
    apiToken,
    ...(env.MVSEP_BASE_URL === undefined ? {} : { baseUrl: env.MVSEP_BASE_URL }),
    outputFormat,
    pollIntervalMs: numberFromEnv(env.MVSEP_POLL_INTERVAL_MS, 10_000),
    maxPollAttempts: numberFromEnv(env.MVSEP_MAX_POLL_ATTEMPTS, 120)
  });
}
