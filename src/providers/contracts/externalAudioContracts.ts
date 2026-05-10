import type { InstrumentFamily } from "../../pipeline/types.ts";

export type ProviderJobStatus = "accepted" | "queued" | "running" | "succeeded" | "failed" | "canceled";

export type ProviderProcessingError = {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export type ProviderAudioFormat = {
  container: "WAV";
  codec: "PCM";
  sampleRateHz: 44100;
  bitDepth: 16 | 24;
  channels: 1 | 2;
};

export type ProviderAudioArtifactRef = {
  artifactId: string;
  url: string;
  filename: string;
  mediaType: "audio/wav";
  sha256: string;
  format: ProviderAudioFormat;
  durationSeconds?: number;
};

export type ProviderMidiArtifactRef = {
  artifactId: string;
  url: string;
  filename: string;
  mediaType: "audio/midi" | "audio/x-midi";
  sha256: string;
  midiFormat: 0 | 1;
  ticksPerQuarter: number;
};

export type ProviderInstrumentLabel = {
  canonicalName: string;
  family: InstrumentFamily;
  confidence: number;
  method: "filename-hint" | "manual" | "provider-native";
  midiProgram?: number;
  sampleLibraryKey?: string;
};

export type ProviderAsyncJobAccepted = {
  providerJobId: string;
  status: "accepted";
  statusUrl: string;
  estimatedCompletionSeconds?: number;
};

export type DereverbJobRequest = {
  remuseJobId: string;
  inputAudio: ProviderAudioArtifactRef;
  outputFormat: ProviderAudioFormat;
  callbackUrl?: string;
};

export type DereverbJobResult = {
  providerJobId: string;
  status: ProviderJobStatus;
  dryOnly?: ProviderAudioArtifactRef;
  reverbOnly?: ProviderAudioArtifactRef;
  error?: ProviderProcessingError;
};

export type StemSeparationJobRequest = {
  remuseJobId: string;
  sourceAudio: ProviderAudioArtifactRef;
  outputFormat: ProviderAudioFormat;
  maxStems?: number;
  callbackUrl?: string;
};

export type StemSeparationJobResult = {
  providerJobId: string;
  status: ProviderJobStatus;
  stems?: Array<{
    stemIndex: number;
    providerLabel?: string;
    audio: ProviderAudioArtifactRef;
  }>;
  error?: ProviderProcessingError;
};

export type MidiConversionJobRequest = {
  remuseJobId: string;
  stems: Array<{
    stemIndex: number;
    audio: ProviderAudioArtifactRef;
    label: ProviderInstrumentLabel;
    outputFilename?: string;
  }>;
  midiFormat: 1;
  quantization?: "none" | "nearest-1-960" | "nearest-1-480" | "nearest-1-240";
  callbackUrl?: string;
};

export type MidiConversionJobResult = {
  providerJobId: string;
  status: ProviderJobStatus;
  midiFiles?: Array<{
    stemIndex: number;
    label: ProviderInstrumentLabel;
    midi: ProviderMidiArtifactRef;
  }>;
  error?: ProviderProcessingError;
};
