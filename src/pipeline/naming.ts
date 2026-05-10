import type { HumanInstrumentReviewOption, InstrumentFamily, InstrumentLabel } from "./types.ts";

const familyHints: Array<{
  family: InstrumentFamily;
  canonicalName: string;
  hints: string[];
  confidence: number;
  midiProgram?: number;
  sampleLibraryKey?: string;
}> = [
  { family: "unknown", canonicalName: "instrumental", hints: ["instrum", "instrumental", "accompaniment", "no vocal", "no vocals"], confidence: 0.45 },
  { family: "unknown", canonicalName: "other", hints: ["other"], confidence: 0.45 },
  { family: "vocal", canonicalName: "lead-vocals", hints: ["lead vocal", "lead vocals"], confidence: 0.86, sampleLibraryKey: "lead-vocal-synth" },
  { family: "vocal", canonicalName: "back-vocals", hints: ["back vocal", "back vocals", "backing vocal", "backing vocals"], confidence: 0.82, sampleLibraryKey: "backing-vocal-synth" },
  { family: "vocal", canonicalName: "vocals", hints: ["vocal", "vocals", "voice", "vox"], confidence: 0.86, sampleLibraryKey: "vocal-synth" },
  { family: "drums", canonicalName: "kick", hints: ["kick"], confidence: 0.82, sampleLibraryKey: "studio-drums" },
  { family: "drums", canonicalName: "snare", hints: ["snare"], confidence: 0.82, sampleLibraryKey: "studio-drums" },
  { family: "drums", canonicalName: "toms", hints: ["tom", "toms"], confidence: 0.82, sampleLibraryKey: "studio-drums" },
  { family: "drums", canonicalName: "cymbals", hints: ["cymbal", "cymbals", "hat", "hats"], confidence: 0.82, sampleLibraryKey: "studio-drums" },
  { family: "drums", canonicalName: "drums", hints: ["drum", "drums"], confidence: 0.88, sampleLibraryKey: "studio-drums" },
  { family: "bass", canonicalName: "bass", hints: ["bass"], confidence: 0.88, midiProgram: 33, sampleLibraryKey: "electric-bass" },
  { family: "guitar", canonicalName: "guitar", hints: ["electric guitar", "acoustic guitar", "guitar", "strum"], confidence: 0.84, midiProgram: 27, sampleLibraryKey: "clean-electric-guitar" },
  { family: "keys", canonicalName: "piano", hints: ["piano"], confidence: 0.88, midiProgram: 1, sampleLibraryKey: "grand-piano" },
  { family: "keys", canonicalName: "organ", hints: ["organ"], confidence: 0.78, midiProgram: 17, sampleLibraryKey: "tonewheel-organ" },
  { family: "keys", canonicalName: "keys", hints: ["keys", "keyboard"], confidence: 0.78, midiProgram: 1, sampleLibraryKey: "grand-piano" },
  { family: "strings", canonicalName: "strings", hints: ["violin", "viola", "cello", "string", "strings"], confidence: 0.78, midiProgram: 49, sampleLibraryKey: "studio-strings" },
  { family: "wind", canonicalName: "brass", hints: ["brass", "trumpet", "trombone", "tuba", "french horn", "french horns"], confidence: 0.74, midiProgram: 62, sampleLibraryKey: "studio-brass" },
  { family: "wind", canonicalName: "woodwinds", hints: ["wind", "winds", "woodwind", "woodwinds", "flute", "clarinet", "sax", "oboe", "english horn", "bassoon", "recorder", "piccolo"], confidence: 0.74, midiProgram: 67, sampleLibraryKey: "studio-winds" },
  { family: "synth", canonicalName: "synth", hints: ["synth", "synthesizer", "pad"], confidence: 0.78, midiProgram: 90, sampleLibraryKey: "analog-synth" },
  { family: "percussion", canonicalName: "percussion", hints: ["perc", "conga", "bongo", "shaker"], confidence: 0.72, sampleLibraryKey: "world-percussion" }
];

export const HUMAN_INSTRUMENT_REVIEW_OPTIONS: readonly HumanInstrumentReviewOption[] = [
  { canonicalName: "brass", displayName: "Brass", family: "wind", midiProgram: 62, sampleLibraryKey: "studio-brass" },
  { canonicalName: "woodwinds", displayName: "Woodwinds", family: "wind", midiProgram: 67, sampleLibraryKey: "studio-winds" },
  { canonicalName: "strings", displayName: "Strings", family: "strings", midiProgram: 49, sampleLibraryKey: "studio-strings" },
  { canonicalName: "percussion", displayName: "Percussion", family: "percussion", sampleLibraryKey: "world-percussion" },
  { canonicalName: "organ", displayName: "Organ", family: "keys", midiProgram: 17, sampleLibraryKey: "tonewheel-organ" },
  { canonicalName: "synth", displayName: "Synthesizer", family: "synth", midiProgram: 90, sampleLibraryKey: "analog-synth" }
];

export function normalizeInstrumentName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "unknown-instrument";
}

function normalizedSearchText(input: string): string {
  return normalizeInstrumentName(input).replace(/-/g, " ");
}

function findInstrumentHint(searchText: string): (typeof familyHints)[number] | undefined {
  return familyHints.find((candidate) => candidate.hints.some((hint) => searchText.includes(normalizedSearchText(hint))));
}

export function instrumentNameCandidateFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const withoutExtension = base.replace(/\.[a-z0-9]+$/i, "");
  const remuseStemMatch = withoutExtension.match(/(?:^|\.)stem-\d+\.([^.]+)$/i);
  const mvsepStemMatch =
    withoutExtension.match(/_(?:bs\d*stem|stem|bs[-_]?roformer[-_]?sw)_mt_\d+_(.+)$/i) ??
    withoutExtension.match(/_mt_\d+_(.+)$/i);
  const candidate = remuseStemMatch?.[1] ?? mvsepStemMatch?.[1] ?? withoutExtension.split(/[_.]/).filter(Boolean).at(-1);

  return candidate ?? withoutExtension;
}

export function inferInstrumentLabel(input: {
  providerLabel?: string | undefined;
  filename?: string | undefined;
  detectedFromArtifactId: string;
  method?: InstrumentLabel["method"] | undefined;
}): InstrumentLabel {
  const providerLabel = input.providerLabel?.trim();
  const filename = input.filename?.trim();
  const providerMatch = providerLabel === undefined ? undefined : findInstrumentHint(normalizedSearchText(providerLabel));
  const filenameMatch = filename === undefined ? undefined : findInstrumentHint(normalizedSearchText(filename));
  const match = providerMatch ?? filenameMatch;
  const fallbackName = normalizeInstrumentName(providerLabel ?? (filename === undefined ? "" : instrumentNameCandidateFromFilename(filename)));
  const method = input.method ?? (providerLabel === undefined ? "filename-hint" : "provider-native");

  return {
    canonicalName: match?.canonicalName ?? fallbackName,
    family: match?.family ?? "unknown",
    confidence: match?.confidence ?? (method === "provider-native" ? 0.4 : 0.35),
    detectedFromArtifactId: input.detectedFromArtifactId,
    method,
    ...(match?.midiProgram === undefined ? {} : { midiProgram: match.midiProgram }),
    ...(match?.sampleLibraryKey === undefined ? {} : { sampleLibraryKey: match.sampleLibraryKey })
  };
}

export function inferInstrumentLabelFromName(name: string, detectedFromArtifactId: string): InstrumentLabel {
  return inferInstrumentLabel({
    filename: name,
    detectedFromArtifactId,
    method: "filename-hint"
  });
}

export function needsHumanInstrumentReview(label: InstrumentLabel): boolean {
  return label.family === "unknown" || label.canonicalName === "instrumental" || label.canonicalName === "other" || label.confidence < 0.5;
}

export function humanInstrumentReviewOptions(): HumanInstrumentReviewOption[] {
  return HUMAN_INSTRUMENT_REVIEW_OPTIONS.map((option) => ({ ...option }));
}

export function labelForManualInstrumentSelection(selection: string, detectedFromArtifactId: string): InstrumentLabel {
  const normalizedSelection = normalizeInstrumentName(selection);
  const option = HUMAN_INSTRUMENT_REVIEW_OPTIONS.find(
    (item) => normalizeInstrumentName(item.canonicalName) === normalizedSelection || normalizeInstrumentName(item.displayName) === normalizedSelection
  );

  if (option === undefined) {
    throw new Error(`Unsupported manual instrument selection: ${selection}.`);
  }

  return {
    canonicalName: option.canonicalName,
    family: option.family,
    confidence: 1,
    detectedFromArtifactId,
    method: "manual",
    ...(option.midiProgram === undefined ? {} : { midiProgram: option.midiProgram }),
    ...(option.sampleLibraryKey === undefined ? {} : { sampleLibraryKey: option.sampleLibraryKey })
  };
}

export function makeMidiFilename(jobId: string, label: InstrumentLabel, stemIndex: number): string {
  const safeInstrument = normalizeInstrumentName(label.canonicalName);
  const paddedIndex = String(stemIndex + 1).padStart(2, "0");
  return `${jobId}_${paddedIndex}_${safeInstrument}.mid`;
}
