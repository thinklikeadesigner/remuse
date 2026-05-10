import type { InstrumentFamily, InstrumentLabel, SampleLibraryAssignment } from "../../pipeline/types.ts";

type SampleLibraryDefinition = Omit<SampleLibraryAssignment, "family"> & {
  family: InstrumentFamily | "from-instrument";
};

const soundfontId = "opendaw-general-midi";

const sampleLibraries: Record<string, SampleLibraryDefinition> = {
  "lead-vocal-synth": {
    key: "lead-vocal-synth",
    displayName: "Solo Vox Lead",
    family: "vocal",
    engine: "opendaw-soundfont",
    midiProgram: 86,
    soundfontId,
    presetIndex: 85,
    presetName: "Solo Vox"
  },
  "backing-vocal-synth": {
    key: "backing-vocal-synth",
    displayName: "Backing Voice Oohs",
    family: "vocal",
    engine: "opendaw-soundfont",
    midiProgram: 54,
    soundfontId,
    presetIndex: 53,
    presetName: "Voice Oohs"
  },
  "vocal-synth": {
    key: "vocal-synth",
    displayName: "Solo Vox",
    family: "vocal",
    engine: "opendaw-soundfont",
    midiProgram: 86,
    soundfontId,
    presetIndex: 85,
    presetName: "Solo Vox"
  },
  "studio-drums": {
    key: "studio-drums",
    displayName: "Jazz Drums",
    family: "drums",
    engine: "opendaw-soundfont",
    midiProgram: 33,
    soundfontId,
    soundfontBank: 128,
    presetIndex: 32,
    presetName: "Jazz",
    isPercussion: true
  },
  "electric-bass": {
    key: "electric-bass",
    displayName: "Upright Bass",
    family: "bass",
    engine: "opendaw-soundfont",
    midiProgram: 33,
    soundfontId,
    presetIndex: 32,
    presetName: "Acoustic Bass"
  },
  "clean-electric-guitar": {
    key: "clean-electric-guitar",
    displayName: "Jazz Guitar",
    family: "guitar",
    engine: "opendaw-soundfont",
    midiProgram: 27,
    soundfontId,
    presetIndex: 26,
    presetName: "Jazz Guitar"
  },
  "grand-piano": {
    key: "grand-piano",
    displayName: "Stereo Grand Piano",
    family: "keys",
    engine: "opendaw-soundfont",
    midiProgram: 1,
    soundfontId,
    presetIndex: 0,
    presetName: "Stereo Grand"
  },
  "tonewheel-organ": {
    key: "tonewheel-organ",
    displayName: "Tonewheel Organ",
    family: "keys",
    engine: "opendaw-soundfont",
    midiProgram: 17,
    soundfontId,
    presetIndex: 16,
    presetName: "Tonewheel Organ"
  },
  "studio-strings": {
    key: "studio-strings",
    displayName: "Studio Strings",
    family: "strings",
    engine: "opendaw-soundfont",
    midiProgram: 49,
    soundfontId,
    presetIndex: 48,
    presetName: "Stereo Strings Fast"
  },
  "studio-brass": {
    key: "studio-brass",
    displayName: "Studio Brass",
    family: "wind",
    engine: "opendaw-soundfont",
    midiProgram: 62,
    soundfontId,
    presetIndex: 61,
    presetName: "Brass Section"
  },
  "studio-winds": {
    key: "studio-winds",
    displayName: "Tenor Sax",
    family: "wind",
    engine: "opendaw-soundfont",
    midiProgram: 67,
    soundfontId,
    presetIndex: 66,
    presetName: "Tenor Sax"
  },
  "analog-synth": {
    key: "analog-synth",
    displayName: "Warm Synth Pad",
    family: "synth",
    engine: "opendaw-soundfont",
    midiProgram: 90,
    soundfontId,
    presetIndex: 89,
    presetName: "Warm Pad"
  },
  "world-percussion": {
    key: "world-percussion",
    displayName: "Jazz Percussion",
    family: "percussion",
    engine: "opendaw-soundfont",
    midiProgram: 33,
    soundfontId,
    soundfontBank: 128,
    presetIndex: 32,
    presetName: "Jazz",
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
  presetName: "Stereo Grand",
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
