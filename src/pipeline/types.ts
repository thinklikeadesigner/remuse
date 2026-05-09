export type Aiff44100Format = {
  container: "AIFF";
  sampleRateHz: 44100;
  bitDepth: 16;
  channels: 1 | 2;
};

export type ArtifactKind =
  | "input-audio"
  | "dry-audio"
  | "reverb-audio"
  | "instrument-stem"
  | "midi"
  | "opendaw-session"
  | "stereo-bounce";

export type ArtifactBase = {
  id: string;
  kind: ArtifactKind;
  uri: string;
  filename: string;
  sourceArtifactIds: string[];
  metadata: Record<string, string | number | boolean>;
};

export type AudioArtifact = ArtifactBase & {
  kind: "input-audio" | "dry-audio" | "reverb-audio" | "instrument-stem" | "stereo-bounce";
  format: Aiff44100Format;
  durationSeconds?: number;
};

export type MidiArtifact = ArtifactBase & {
  kind: "midi";
  instrument: InstrumentLabel;
};

export type OpenDawSessionArtifact = ArtifactBase & {
  kind: "opendaw-session";
  sessionId: string;
  trackCount: number;
};

export type PipelineArtifact = AudioArtifact | MidiArtifact | OpenDawSessionArtifact;

export type InstrumentFamily =
  | "vocal"
  | "drums"
  | "bass"
  | "guitar"
  | "keys"
  | "strings"
  | "brass"
  | "woodwinds"
  | "synth"
  | "percussion"
  | "unknown";

export type InstrumentLabel = {
  canonicalName: string;
  family: InstrumentFamily;
  confidence: number;
  detectedFromArtifactId: string;
  method: "ai-audio-analysis" | "filename-hint" | "manual" | "mock";
  midiProgram?: number;
  sampleLibraryKey?: string;
};

export type InstrumentStem = {
  stem: AudioArtifact & { kind: "instrument-stem" };
  label?: InstrumentLabel;
};

export type DereverbResult = {
  dryOnly: AudioArtifact & { kind: "dry-audio" };
  reverbOnly: AudioArtifact & { kind: "reverb-audio" };
};

export type MidiConversionResult = {
  midiFiles: MidiArtifact[];
};

export type OpenDawTrackPlan = {
  trackName: string;
  midiFile: MidiArtifact;
  sampleLibraryKey: string;
};

export type OpenDawSessionResult = {
  session: OpenDawSessionArtifact;
  tracks: OpenDawTrackPlan[];
};

export type BounceResult = {
  bounce: AudioArtifact & { kind: "stereo-bounce" };
  session: OpenDawSessionArtifact;
};

export type PipelineStepName =
  | "validate-input"
  | "de-reverb"
  | "instrument-stem-separation"
  | "instrument-identification"
  | "midi-conversion"
  | "opendaw-session-create"
  | "opendaw-midi-import"
  | "opendaw-bounce";

export type PipelineStepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped";

export type PipelineStepEvent = {
  step: PipelineStepName;
  status: PipelineStepStatus;
  message: string;
  at: string;
};

export type PipelineJobInput = {
  jobId: string;
  inputAudio: AudioArtifact & { kind: "input-audio" };
};

export type PipelineJobResult = {
  jobId: string;
  inputAudio: AudioArtifact & { kind: "input-audio" };
  dereverb: DereverbResult;
  instrumentStems: InstrumentStem[];
  midi: MidiConversionResult;
  opendaw: OpenDawSessionResult;
  bounce: BounceResult;
  events: PipelineStepEvent[];
};

export type ProviderContext = {
  jobId: string;
  traceId: string;
  emit: (event: PipelineStepEvent) => void;
};

export interface DereverbProvider {
  splitReverb(input: AudioArtifact & { kind: "input-audio" }, context: ProviderContext): Promise<DereverbResult>;
}

export interface InstrumentStemSeparationProvider {
  separateInstruments(
    dryOnly: AudioArtifact & { kind: "dry-audio" },
    context: ProviderContext
  ): Promise<InstrumentStem[]>;
}

export interface InstrumentIdentificationProvider {
  identifyInstruments(stems: InstrumentStem[], context: ProviderContext): Promise<InstrumentStem[]>;
}

export interface MidiConversionProvider {
  convertStemsToMidi(stems: Array<InstrumentStem & { label: InstrumentLabel }>, context: ProviderContext): Promise<MidiConversionResult>;
}

export interface OpenDawProvider {
  createSession(context: ProviderContext): Promise<OpenDawSessionArtifact>;
  importMidiTracks(
    session: OpenDawSessionArtifact,
    midiFiles: MidiArtifact[],
    context: ProviderContext
  ): Promise<OpenDawSessionResult>;
  bounceSession(session: OpenDawSessionArtifact, context: ProviderContext): Promise<BounceResult>;
}

export type PipelineProviders = {
  dereverb: DereverbProvider;
  instrumentStemSeparation: InstrumentStemSeparationProvider;
  instrumentIdentification: InstrumentIdentificationProvider;
  midiConversion: MidiConversionProvider;
  opendaw: OpenDawProvider;
};
