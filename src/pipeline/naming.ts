import type { InstrumentFamily, InstrumentLabel } from "./types.ts";

const familyHints: Array<{
  family: InstrumentFamily;
  canonicalName: string;
  hints: string[];
  midiProgram?: number;
  sampleLibraryKey?: string;
}> = [
  { family: "drums", canonicalName: "drums", hints: ["drum", "kick", "snare", "hat", "cymbal"], sampleLibraryKey: "studio-drums" },
  { family: "bass", canonicalName: "electric-bass", hints: ["bass"], midiProgram: 33, sampleLibraryKey: "electric-bass" },
  { family: "guitar", canonicalName: "clean-guitar", hints: ["guitar", "strum"], midiProgram: 29, sampleLibraryKey: "clean-electric-guitar" },
  { family: "keys", canonicalName: "piano", hints: ["piano", "keys", "keyboard", "organ"], midiProgram: 1, sampleLibraryKey: "grand-piano" },
  { family: "strings", canonicalName: "strings", hints: ["violin", "viola", "cello", "strings"], midiProgram: 49, sampleLibraryKey: "studio-strings" },
  { family: "brass", canonicalName: "brass", hints: ["trumpet", "trombone", "horn", "brass"], midiProgram: 57, sampleLibraryKey: "studio-brass" },
  { family: "woodwinds", canonicalName: "woodwinds", hints: ["flute", "clarinet", "sax", "woodwind"], midiProgram: 74, sampleLibraryKey: "studio-woodwinds" },
  { family: "synth", canonicalName: "synth", hints: ["synth", "pad", "lead"], midiProgram: 81, sampleLibraryKey: "analog-synth" },
  { family: "vocal", canonicalName: "vocal", hints: ["vocal", "voice", "vox"], sampleLibraryKey: "vocal-synth" },
  { family: "percussion", canonicalName: "percussion", hints: ["perc", "conga", "bongo", "shaker"], sampleLibraryKey: "world-percussion" }
];

export function normalizeInstrumentName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "unknown-instrument";
}

export function inferInstrumentLabelFromName(name: string, detectedFromArtifactId: string): InstrumentLabel {
  const normalized = normalizeInstrumentName(name);
  const match = familyHints.find((candidate) => candidate.hints.some((hint) => normalized.includes(hint)));

  return {
    canonicalName: match?.canonicalName ?? normalized,
    family: match?.family ?? "unknown",
    confidence: match ? 0.72 : 0.35,
    detectedFromArtifactId,
    method: "filename-hint",
    ...(match?.midiProgram === undefined ? {} : { midiProgram: match.midiProgram }),
    ...(match?.sampleLibraryKey === undefined ? {} : { sampleLibraryKey: match.sampleLibraryKey })
  };
}

export function makeMidiFilename(jobId: string, label: InstrumentLabel, stemIndex: number): string {
  const safeInstrument = normalizeInstrumentName(label.canonicalName);
  const paddedIndex = String(stemIndex + 1).padStart(2, "0");
  return `${jobId}_${paddedIndex}_${safeInstrument}.mid`;
}
