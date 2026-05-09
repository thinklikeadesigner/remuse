import type {
  InstrumentLabel,
  InstrumentStem,
  PipelineJobInput,
  PipelineJobResult,
  PipelineProviders,
  PipelineStepEvent,
  PipelineStepName,
  ProviderContext
} from "./types.ts";

function nowIso(): string {
  return new Date().toISOString();
}

function isLabeledStem(stem: InstrumentStem): stem is InstrumentStem & { label: InstrumentLabel } {
  return stem.label !== undefined;
}

export type PipelineRunOptions = {
  onEvent?: (event: PipelineStepEvent) => void | Promise<void>;
};

export async function runPipeline(
  input: PipelineJobInput,
  providers: PipelineProviders,
  options: PipelineRunOptions = {}
): Promise<PipelineJobResult> {
  const events: PipelineStepEvent[] = [];

  const emit = async (event: PipelineStepEvent): Promise<void> => {
    events.push(event);
    await options.onEvent?.(event);
  };

  const context: ProviderContext = {
    jobId: input.jobId,
    traceId: `trace-${input.jobId}`,
    emit
  };

  const start = (step: PipelineStepName, message: string): Promise<void> =>
    emit({ step, status: "running", message, at: nowIso() });
  const succeed = (step: PipelineStepName, message: string): Promise<void> =>
    emit({ step, status: "succeeded", message, at: nowIso() });

  await start("validate-input", "Checking input audio format.");
  const format = input.inputAudio.format;
  if (format.container !== "WAV" || format.codec !== "PCM" || format.sampleRateHz !== 44100 || format.bitDepth !== 24) {
    await emit({
      step: "validate-input",
      status: "failed",
      message: "Input must be canonical WAV PCM 24-bit, 44.1 kHz.",
      at: nowIso()
    });
    throw new Error("Unsupported input format.");
  }
  await succeed("validate-input", "Input audio format accepted.");

  await start("de-reverb", "Splitting input into dry-only and reverb-only tracks.");
  const dereverb = await providers.dereverb.splitReverb(input.inputAudio, context);
  await succeed("de-reverb", "De-reverb split completed.");

  await start("instrument-stem-separation", "Separating dry-only audio into instrument stems.");
  const separatedStems = await providers.instrumentStemSeparation.separateInstruments(dereverb.dryOnly, context);
  await succeed("instrument-stem-separation", `Created ${separatedStems.length} instrument stems.`);

  await start("instrument-identification", "Identifying instruments for each stem.");
  const instrumentStems = await providers.instrumentIdentification.identifyInstruments(separatedStems, context);
  const labeledStems = instrumentStems.filter(isLabeledStem);
  if (labeledStems.length !== instrumentStems.length) {
    await emit({
      step: "instrument-identification",
      status: "failed",
      message: "Every stem must have an instrument label before MIDI conversion.",
      at: nowIso()
    });
    throw new Error("Missing instrument labels.");
  }
  await succeed("instrument-identification", `Identified ${labeledStems.length} instruments.`);

  await start("midi-conversion", "Converting labeled stems to MIDI files.");
  const midi = await providers.midiConversion.convertStemsToMidi(labeledStems, context);
  await succeed("midi-conversion", `Created ${midi.midiFiles.length} MIDI files.`);

  await start("opendaw-session-create", "Creating blank OpenDAW session.");
  const session = await providers.opendaw.createSession(context);
  await succeed("opendaw-session-create", `Created OpenDAW session ${session.sessionId}.`);

  await start("opendaw-midi-import", "Importing MIDI files and assigning sample libraries.");
  const opendaw = await providers.opendaw.importMidiTracks(session, midi.midiFiles, context);
  await succeed("opendaw-midi-import", `Imported ${opendaw.tracks.length} MIDI tracks.`);

  await start("opendaw-bounce", "Rendering stereo WAV PCM 16-bit, 44.1 kHz bounce.");
  const bounce = await providers.opendaw.bounceSession(opendaw.session, context);
  await succeed("opendaw-bounce", `Created final bounce ${bounce.bounce.filename}.`);

  return {
    jobId: input.jobId,
    inputAudio: input.inputAudio,
    dereverb,
    instrumentStems,
    midi,
    opendaw,
    bounce,
    events
  };
}
