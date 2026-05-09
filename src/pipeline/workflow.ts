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

export async function runPipeline(input: PipelineJobInput, providers: PipelineProviders): Promise<PipelineJobResult> {
  const events: PipelineStepEvent[] = [];

  const emit = (event: PipelineStepEvent): void => {
    events.push(event);
  };

  const context: ProviderContext = {
    jobId: input.jobId,
    traceId: `trace-${input.jobId}`,
    emit
  };

  const start = (step: PipelineStepName, message: string): void => emit({ step, status: "running", message, at: nowIso() });
  const succeed = (step: PipelineStepName, message: string): void => emit({ step, status: "succeeded", message, at: nowIso() });

  start("validate-input", "Checking input audio format.");
  const format = input.inputAudio.format;
  if (format.container !== "WAV" || format.codec !== "PCM" || format.sampleRateHz !== 44100 || format.bitDepth !== 24) {
    emit({
      step: "validate-input",
      status: "failed",
      message: "Input must be canonical WAV PCM 24-bit, 44.1 kHz.",
      at: nowIso()
    });
    throw new Error("Unsupported input format.");
  }
  succeed("validate-input", "Input audio format accepted.");

  start("de-reverb", "Splitting input into dry-only and reverb-only tracks.");
  const dereverb = await providers.dereverb.splitReverb(input.inputAudio, context);
  succeed("de-reverb", "De-reverb split completed.");

  start("instrument-stem-separation", "Separating dry-only audio into instrument stems.");
  const separatedStems = await providers.instrumentStemSeparation.separateInstruments(dereverb.dryOnly, context);
  succeed("instrument-stem-separation", `Created ${separatedStems.length} instrument stems.`);

  start("instrument-identification", "Identifying instruments for each stem.");
  const instrumentStems = await providers.instrumentIdentification.identifyInstruments(separatedStems, context);
  const labeledStems = instrumentStems.filter(isLabeledStem);
  if (labeledStems.length !== instrumentStems.length) {
    emit({
      step: "instrument-identification",
      status: "failed",
      message: "Every stem must have an instrument label before MIDI conversion.",
      at: nowIso()
    });
    throw new Error("Missing instrument labels.");
  }
  succeed("instrument-identification", `Identified ${labeledStems.length} instruments.`);

  start("midi-conversion", "Converting labeled stems to MIDI files.");
  const midi = await providers.midiConversion.convertStemsToMidi(labeledStems, context);
  succeed("midi-conversion", `Created ${midi.midiFiles.length} MIDI files.`);

  start("opendaw-session-create", "Creating blank OpenDAW session.");
  const session = await providers.opendaw.createSession(context);
  succeed("opendaw-session-create", `Created OpenDAW session ${session.sessionId}.`);

  start("opendaw-midi-import", "Importing MIDI files and assigning sample libraries.");
  const opendaw = await providers.opendaw.importMidiTracks(session, midi.midiFiles, context);
  succeed("opendaw-midi-import", `Imported ${opendaw.tracks.length} MIDI tracks.`);

  start("opendaw-bounce", "Rendering stereo WAV PCM 16-bit, 44.1 kHz bounce.");
  const bounce = await providers.opendaw.bounceSession(opendaw.session, context);
  succeed("opendaw-bounce", `Created final bounce ${bounce.bounce.filename}.`);

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
