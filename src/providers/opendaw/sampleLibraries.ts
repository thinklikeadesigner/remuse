import type { InstrumentFamily, InstrumentLabel, SampleLibraryAssignment } from "../../pipeline/types.ts";

type SampleLibraryDefinition = Omit<SampleLibraryAssignment, "family"> & {
  family: InstrumentFamily | "from-instrument";
};

const soundfontId = "opendaw-general-midi";

const sampleLibraries: Record<string, SampleLibraryDefinition> = {
  "lead-vocal-synth": {
    key: "lead-vocal-synth",
    displayName: "Voice Lead Synth",
    family: "vocal",
    engine: "opendaw-soundfont",
    midiProgram: 54,
    soundfontId,
    presetIndex: 53,
    presetName: "Voice Oohs"
  },
  "backing-vocal-synth": {
    key: "backing-vocal-synth",
    displayName: "Backing Vocal Pad",
    family: "vocal",
    engine: "opendaw-soundfont",
    midiProgram: 55,
    soundfontId,
    presetIndex: 54,
    presetName: "Synth Voice"
  },
  "vocal-synth": {
    key: "vocal-synth",
    displayName: "Vocal Synth",
    family: "vocal",
    engine: "opendaw-soundfont",
    midiProgram: 54,
    soundfontId,
    presetIndex: 53,
    presetName: "Voice Oohs"
  },
  "studio-drums": {
    key: "studio-drums",
    displayName: "Studio Drums",
    family: "drums",
    engine: "opendaw-soundfont",
    midiProgram: 1,
    soundfontId,
    presetIndex: 0,
    presetName: "Standard Drum Kit",
    isPercussion: true
  },
  "electric-bass": {
    key: "electric-bass",
    displayName: "Electric Bass",
    family: "bass",
    engine: "opendaw-soundfont",
    midiProgram: 33,
    soundfontId,
    presetIndex: 32,
    presetName: "Acoustic Bass"
  },
  "clean-electric-guitar": {
    key: "clean-electric-guitar",
    displayName: "Clean Electric Guitar",
    family: "guitar",
    engine: "opendaw-soundfont",
    midiProgram: 29,
    soundfontId,
    presetIndex: 28,
    presetName: "Electric Guitar Clean"
  },
  "grand-piano": {
    key: "grand-piano",
    displayName: "Grand Piano",
    family: "keys",
    engine: "opendaw-soundfont",
    midiProgram: 1,
    soundfontId,
    presetIndex: 0,
    presetName: "Acoustic Grand Piano"
  },
  "tonewheel-organ": {
    key: "tonewheel-organ",
    displayName: "Tonewheel Organ",
    family: "keys",
    engine: "opendaw-soundfont",
    midiProgram: 17,
    soundfontId,
    presetIndex: 16,
    presetName: "Drawbar Organ"
  },
  "studio-strings": {
    key: "studio-strings",
    displayName: "Studio Strings",
    family: "strings",
    engine: "opendaw-soundfont",
    midiProgram: 49,
    soundfontId,
    presetIndex: 48,
    presetName: "String Ensemble 1"
  },
  "studio-winds": {
    key: "studio-winds",
    displayName: "Studio Winds",
    family: "wind",
    engine: "opendaw-soundfont",
    midiProgram: 74,
    soundfontId,
    presetIndex: 73,
    presetName: "Flute"
  },
  "analog-synth": {
    key: "analog-synth",
    displayName: "Analog Synth",
    family: "synth",
    engine: "opendaw-soundfont",
    midiProgram: 81,
    soundfontId,
    presetIndex: 80,
    presetName: "Lead 1 Square"
  },
  "world-percussion": {
    key: "world-percussion",
    displayName: "World Percussion",
    family: "percussion",
    engine: "opendaw-soundfont",
    midiProgram: 1,
    soundfontId,
    presetIndex: 0,
    presetName: "Standard Drum Kit",
    isPercussion: true
  }
};

const fallbackLibrary: SampleLibraryDefinition = {
  key: "general-midi-fallback",
  displayName: "General MIDI Fallback",
  family: "from-instrument",
  engine: "general-midi-fallback",
  midiProgram: 1,
  soundfontId,
  presetIndex: 0,
  presetName: "Acoustic Grand Piano",
  fallbackReason: "No explicit sample library was mapped for this instrument."
};

function materialize(definition: SampleLibraryDefinition, instrument: InstrumentLabel): SampleLibraryAssignment {
  const midiProgram = instrument.midiProgram ?? definition.midiProgram;
  return {
    ...definition,
    family: definition.family === "from-instrument" ? instrument.family : definition.family,
    ...(midiProgram === undefined ? {} : { midiProgram })
  };
}

export function sampleLibraryForInstrument(instrument: InstrumentLabel): SampleLibraryAssignment {
  const definition = instrument.sampleLibraryKey === undefined ? fallbackLibrary : sampleLibraries[instrument.sampleLibraryKey] ?? fallbackLibrary;
  const assignment = materialize(definition, instrument);

  if (definition === fallbackLibrary && instrument.sampleLibraryKey !== undefined) {
    return {
      ...assignment,
      fallbackReason: `Unknown sample library key "${instrument.sampleLibraryKey}".`
    };
  }

  return assignment;
}

export function knownSampleLibraryKeys(): string[] {
  return Object.keys(sampleLibraries).sort();
}
