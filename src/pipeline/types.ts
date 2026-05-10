export type AudioFormat = {
  container: "WAV";
  codec: "PCM";
  sampleRateHz: 44100;
  bitDepth: 16 | 24;
  channels: 1 | 2;
};

export type ArtifactKind =
  | "input-audio"
  | "dry-audio"
  | "reverb-audio"
  | "instrument-stem"
  | "review-clip"
  | "midi"
  | "opendaw-session"
  | "diagnostic-track-bounce"
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
  kind:
    | "input-audio"
    | "dry-audio"
    | "reverb-audio"
    | "instrument-stem"
    | "review-clip"
    | "diagnostic-track-bounce"
    | "stereo-bounce";
  format: AudioFormat;
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
  | "wind"
  | "synth"
  | "percussion"
  | "unknown";

export type InstrumentLabel = {
  canonicalName: string;
  family: InstrumentFamily;
  confidence: number;
  detectedFromArtifactId: string;
  method: "filename-hint" | "manual" | "mock" | "provider-native";
  midiProgram?: number;
  sampleLibraryKey?: string;
};

export type HumanInstrumentReviewOption = {
  canonicalName: string;
  displayName: string;
  family: InstrumentFamily;
  midiProgram?: number;
  sampleLibraryKey?: string;
};

export type HumanInstrumentReviewRequest = {
  id: string;
  stemArtifactId: string;
  stemFilename: string;
  currentLabel: InstrumentLabel;
  clip: AudioArtifact & { kind: "review-clip" };
  options: HumanInstrumentReviewOption[];
  status: "pending" | "resolved" | "discarded";
  selectedLabel?: InstrumentLabel;
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

export type SampleLibraryAssignment = {
  key: string;
  displayName: string;
  family: InstrumentFamily;
  engine: "opendaw-soundfont" | "general-midi-fallback";
  midiProgram?: number;
  soundfontId?: string;
  soundfontBank?: number;
  presetIndex?: number;
  presetName?: string;
  isPercussion?: boolean;
  fallbackReason?: string;
};

export type OpenDawTrackPlan = {
  trackId: string;
  trackIndex: number;
  trackName: string;
  midiFile: MidiArtifact;
  sampleLibraryKey: string;
  sampleLibrary: SampleLibraryAssignment;
  sampleLibraryLoaded: boolean;
};

export type OpenDawSessionResult = {
  session: OpenDawSessionArtifact;
  tracks: OpenDawTrackPlan[];
};

export type DiagnosticTrackBounce = {
  trackIndex: number;
  trackName: string;
  midiArtifactId: string;
  midiFilename: string;
  normalizedInstrument: string;
  sampleLibraryKey: string;
  sampleLibrary: SampleLibraryAssignment;
  bounce: AudioArtifact & { kind: "diagnostic-track-bounce" };
};

export type BounceResult = {
  bounce: AudioArtifact & { kind: "stereo-bounce" };
  session: OpenDawSessionArtifact;
  diagnosticTrackBounces?: DiagnosticTrackBounce[];
};

export type OpenDawRenderTarget = {
  frameCount?: number;
  durationSeconds?: number;
};

export type PipelineStepName =
  | "validate-input"
  | "de-reverb"
  | "instrument-stem-separation"
  | "instrument-label-normalization"
  | "manual-instrument-review"
  | "midi-conversion"
  | "opendaw-session-create"
  | "opendaw-midi-import"
  | "opendaw-bounce";

export type PipelineStepStatus = "pending" | "running" | "succeeded" | "failed" | "skipped" | "awaiting-input";

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
  manualReviews?: HumanInstrumentReviewRequest[];
  midi: MidiConversionResult;
  opendaw: OpenDawSessionResult;
  bounce: BounceResult;
  events: PipelineStepEvent[];
};

export type PipelineManualReviewState = {
  jobId: string;
  inputAudio: AudioArtifact & { kind: "input-audio" };
  dereverb: DereverbResult;
  instrumentStems: InstrumentStem[];
  events: PipelineStepEvent[];
};

export type PendingInstrumentReview = {
  state: PipelineManualReviewState;
  requests: HumanInstrumentReviewRequest[];
};

export type ProviderContext = {
  jobId: string;
  traceId: string;
  emit: (event: PipelineStepEvent) => void | Promise<void>;
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
  bounceSession(session: OpenDawSessionArtifact, context: ProviderContext, renderTarget?: OpenDawRenderTarget): Promise<BounceResult>;
}

export type PipelineProviders = {
  dereverb: DereverbProvider;
  instrumentStemSeparation: InstrumentStemSeparationProvider;
  instrumentIdentification: InstrumentIdentificationProvider;
  midiConversion: MidiConversionProvider;
  opendaw: OpenDawProvider;
};
