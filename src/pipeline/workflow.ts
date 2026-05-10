import type {
  HumanInstrumentReviewRequest,
  InstrumentLabel,
  InstrumentStem,
  PipelineManualReviewState,
  PipelineJobInput,
  PipelineJobResult,
  OpenDawRenderTarget,
  PipelineProviders,
  PipelineStepEvent,
  PipelineStepName,
  ProviderContext
} from "./types.ts";
import { isSupportedWorkflowWav } from "./formats.ts";

function nowIso(): string {
  return new Date().toISOString();
}

function isLabeledStem(stem: InstrumentStem): stem is InstrumentStem & { label: InstrumentLabel } {
  return stem.label !== undefined;
}

export type PipelineRunOptions = {
  onEvent?: (event: PipelineStepEvent) => void | Promise<void>;
};

type PipelineRuntime = {
  events: PipelineStepEvent[];
  context: ProviderContext;
  emit: (event: PipelineStepEvent) => Promise<void>;
  start: (step: PipelineStepName, message: string) => Promise<void>;
  succeed: (step: PipelineStepName, message: string) => Promise<void>;
};

export class ManualInstrumentReviewRequiredError extends Error {
  readonly state: PipelineManualReviewState;
  readonly reviewStems: Array<InstrumentStem & { label: InstrumentLabel }>;

  constructor(state: PipelineManualReviewState, reviewStems: Array<InstrumentStem & { label: InstrumentLabel }>) {
    super(`Human instrument review is required for ${reviewStems.length} stem(s).`);
    this.state = state;
    this.reviewStems = reviewStems;
  }
}

function createRuntime(jobId: string, options: PipelineRunOptions, initialEvents: PipelineStepEvent[] = []): PipelineRuntime {
  const events: PipelineStepEvent[] = [...initialEvents];

  const emit = async (event: PipelineStepEvent): Promise<void> => {
    events.push(event);
    await options.onEvent?.(event);
  };

  const context: ProviderContext = {
    jobId,
    traceId: `trace-${jobId}`,
    emit
  };

  return {
    events,
    context,
    emit,
    start: (step, message) => emit({ step, status: "running", message, at: nowIso() }),
    succeed: (step, message) => emit({ step, status: "succeeded", message, at: nowIso() })
  };
}

function requireLabeledStems(instrumentStems: InstrumentStem[]): Array<InstrumentStem & { label: InstrumentLabel }> {
  const labeledStems = instrumentStems.filter(isLabeledStem);
  if (labeledStems.length !== instrumentStems.length) {
    throw new Error("Every stem must have an instrument label before MIDI conversion.");
  }

  return labeledStems;
}

function renderTargetForState(state: PipelineManualReviewState): OpenDawRenderTarget | undefined {
  const dataBytes = state.inputAudio.metadata.dataBytes;
  const bytesPerFrame = state.inputAudio.format.channels * (state.inputAudio.format.bitDepth / 8);
  const frameCount =
    typeof dataBytes === "number" && Number.isFinite(dataBytes) && bytesPerFrame > 0
      ? Math.floor(dataBytes / bytesPerFrame)
      : undefined;

  if (frameCount === undefined && state.inputAudio.durationSeconds === undefined) {
    return undefined;
  }

  return {
    ...(frameCount === undefined ? {} : { frameCount }),
    ...(state.inputAudio.durationSeconds === undefined ? {} : { durationSeconds: state.inputAudio.durationSeconds })
  };
}

async function finishPipelineFromLabeledStems(
  state: PipelineManualReviewState,
  providers: PipelineProviders,
  runtime: PipelineRuntime,
  manualReviews?: HumanInstrumentReviewRequest[]
): Promise<PipelineJobResult> {
  const labeledStems = requireLabeledStems(state.instrumentStems);

  await runtime.start("midi-conversion", "Converting labeled stems to MIDI files.");
  const midi = await providers.midiConversion.convertStemsToMidi(labeledStems, runtime.context);
  await runtime.succeed("midi-conversion", `Created ${midi.midiFiles.length} MIDI files.`);

  await runtime.start("opendaw-session-create", "Creating blank OpenDAW session.");
  const session = await providers.opendaw.createSession(runtime.context);
  await runtime.succeed("opendaw-session-create", `Created OpenDAW session ${session.sessionId}.`);

  await runtime.start("opendaw-midi-import", "Importing MIDI files and assigning sample libraries.");
  const opendaw = await providers.opendaw.importMidiTracks(session, midi.midiFiles, runtime.context);
  await runtime.succeed("opendaw-midi-import", `Imported ${opendaw.tracks.length} MIDI tracks.`);

  await runtime.start("opendaw-bounce", "Rendering stereo WAV PCM 16-bit, 44.1 kHz bounce.");
  const bounce = await providers.opendaw.bounceSession(opendaw.session, runtime.context, renderTargetForState(state));
  await runtime.succeed("opendaw-bounce", `Created final bounce ${bounce.bounce.filename}.`);

  return {
    jobId: state.jobId,
    inputAudio: state.inputAudio,
    ...(state.dereverb === undefined ? {} : { dereverb: state.dereverb }),
    instrumentStems: state.instrumentStems,
    ...(manualReviews === undefined || manualReviews.length === 0 ? {} : { manualReviews }),
    midi,
    opendaw,
    bounce,
    events: runtime.events
  };
}

export async function runPipeline(
  input: PipelineJobInput,
  providers: PipelineProviders,
  options: PipelineRunOptions = {}
): Promise<PipelineJobResult> {
  const runtime = createRuntime(input.jobId, options);

  await runtime.start("validate-input", "Checking input audio format.");
  const format = input.inputAudio.format;
  if (!isSupportedWorkflowWav(format)) {
    await runtime.emit({
      step: "validate-input",
      status: "failed",
      message: "Input must be WAV PCM 16-bit or 24-bit, 44.1 kHz.",
      at: nowIso()
    });
    throw new Error("Unsupported input format.");
  }
  await runtime.succeed("validate-input", "Input audio format accepted.");

  // De-reverb is intentionally bypassed while comparing stem-separation quality on the original input.
  await runtime.emit({
    step: "de-reverb",
    status: "skipped",
    message: "De-reverb bypassed; sending original input directly to stem separation.",
    at: nowIso()
  });

  await runtime.start("instrument-stem-separation", "Separating original input audio into instrument stems.");
  const separatedStems = await providers.instrumentStemSeparation.separateInstruments(input.inputAudio, runtime.context);
  await runtime.succeed("instrument-stem-separation", `Created ${separatedStems.length} instrument stems.`);

  await runtime.start("instrument-label-normalization", "Normalizing provider instrument labels.");
  const instrumentStems = await providers.instrumentIdentification.identifyInstruments(separatedStems, runtime.context);
  const labeledStems = instrumentStems.filter(isLabeledStem);
  if (labeledStems.length !== instrumentStems.length) {
    await runtime.emit({
      step: "instrument-label-normalization",
      status: "failed",
      message: "Every stem must have an instrument label before MIDI conversion.",
      at: nowIso()
    });
    throw new Error("Missing instrument labels.");
  }
  await runtime.succeed("instrument-label-normalization", `Accepted provider labels for ${labeledStems.length} stems.`);

  await runtime.start("manual-instrument-review", `Preparing human review for ${labeledStems.length} stem(s).`);
  throw new ManualInstrumentReviewRequiredError(
    {
      jobId: input.jobId,
      inputAudio: input.inputAudio,
      instrumentStems,
      events: runtime.events
    },
    labeledStems
  );
}

export async function continuePipelineFromManualReview(
  state: PipelineManualReviewState,
  manualReviews: HumanInstrumentReviewRequest[],
  providers: PipelineProviders,
  options: PipelineRunOptions = {}
): Promise<PipelineJobResult> {
  const runtime = createRuntime(state.jobId, options, state.events);
  const resolvedReviews = manualReviews.filter((request) => request.status === "resolved");
  const discardedReviews = manualReviews.filter((request) => request.status === "discarded");
  await runtime.succeed(
    "manual-instrument-review",
    `Completed manual review with ${resolvedReviews.length} labeled stem(s) and ${discardedReviews.length} discarded stem(s).`
  );
  return finishPipelineFromLabeledStems(state, providers, runtime, manualReviews);
}
