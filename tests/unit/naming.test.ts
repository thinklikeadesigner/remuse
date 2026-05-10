import assert from "node:assert/strict";
import test from "node:test";
import {
  inferInstrumentLabel,
  inferInstrumentLabelFromName,
  instrumentNameCandidateFromFilename,
  defaultManualInstrumentLabelForProviderLabel,
  humanInstrumentReviewOptions,
  labelForManualInstrumentSelection,
  makeMidiFilename,
  needsHumanInstrumentReview,
  normalizeInstrumentName
} from "../../src/pipeline/naming.ts";

test("normalizeInstrumentName creates stable filename-safe labels", () => {
  assert.equal(normalizeInstrumentName("  Clean Guitar!! "), "clean-guitar");
  assert.equal(normalizeInstrumentName(""), "unknown-instrument");
});

test("inferInstrumentLabelFromName maps common names to sample libraries", () => {
  const label = inferInstrumentLabelFromName("stem-03.clean-guitar.wav", "stem-123");

  assert.equal(label.canonicalName, "guitar");
  assert.equal(label.family, "guitar");
  assert.equal(label.sampleLibraryKey, "clean-electric-guitar");
  assert.equal(label.midiProgram, 27);
});

test("inferInstrumentLabel covers MVSEP BS Roformer SW stem inventory", () => {
  const labels = [
    ["vocals", "vocals"],
    ["instrum", "instrumental"],
    ["instrumental", "instrumental"],
    ["bass", "bass"],
    ["drums", "drums"],
    ["guitar", "guitar"],
    ["piano", "piano"],
    ["other", "other"]
  ] as const;

  assert.deepEqual(
    labels.map(([providerLabel, expected]) => inferInstrumentLabel({ providerLabel, detectedFromArtifactId: providerLabel }).canonicalName),
    labels.map(([, expected]) => expected)
  );
});

test("instrumentNameCandidateFromFilename extracts provider stem suffixes", () => {
  assert.equal(
    instrumentNameCandidateFromFilename("20260509183642-song_bs6stem_mt_0_instrum.wav"),
    "instrum"
  );
  assert.equal(
    instrumentNameCandidateFromFilename("20260509183642-song_bs_roformer_sw_mt_0_piano.wav"),
    "piano"
  );
  assert.equal(instrumentNameCandidateFromFilename("song.dry-only.stem-04.clean-guitar.wav"), "clean-guitar");
});

test("inferInstrumentLabel normalizes ambiguous provider stems safely", () => {
  const label = inferInstrumentLabelFromName("20260509183642-song_bs6stem_mt_0_instrum.wav", "stem-789");

  assert.equal(label.canonicalName, "instrumental");
  assert.equal(label.family, "unknown");
  assert.equal(label.confidence, 0.45);
  assert.equal(needsHumanInstrumentReview(label), true);
});

test("inferInstrumentLabel trusts provider labels before filename fallback", () => {
  const label = inferInstrumentLabel({
    providerLabel: "Bass",
    filename: "song.stem-02.other.wav",
    detectedFromArtifactId: "stem-234"
  });

  assert.equal(label.canonicalName, "bass");
  assert.equal(label.method, "provider-native");
  assert.equal(label.sampleLibraryKey, "electric-bass");
  assert.equal(needsHumanInstrumentReview(label), false);
});

test("manual review options cover non-MVSEP instrument choices", () => {
  assert.deepEqual(
    humanInstrumentReviewOptions().map((option) => option.displayName),
    [
      "Lead Vocals",
      "Backing Vocals",
      "Drums",
      "Bass",
      "Guitar",
      "Piano",
      "Brass",
      "Woodwinds",
      "Strings",
      "Percussion",
      "Organ",
      "Synthesizer"
    ]
  );

  const label = labelForManualInstrumentSelection("Synthesizer", "stem-999");
  assert.equal(label.canonicalName, "synth");
  assert.equal(label.family, "synth");
  assert.equal(label.method, "manual");
  assert.equal(label.sampleLibraryKey, "analog-synth");

  const brass = labelForManualInstrumentSelection("Brass", "stem-998");
  assert.equal(brass.canonicalName, "brass");
  assert.equal(brass.midiProgram, 62);
  assert.equal(brass.sampleLibraryKey, "studio-brass");

  const woodwinds = labelForManualInstrumentSelection("Woodwinds", "stem-997");
  assert.equal(woodwinds.canonicalName, "woodwinds");
  assert.equal(woodwinds.midiProgram, 67);
  assert.equal(woodwinds.sampleLibraryKey, "studio-winds");

  const strings = labelForManualInstrumentSelection("Strings", "stem-996");
  assert.equal(strings.canonicalName, "strings");
  assert.equal(strings.midiProgram, 49);
  assert.equal(strings.sampleLibraryKey, "studio-strings");

  const leadVocals = labelForManualInstrumentSelection("Lead Vocals", "stem-995");
  assert.equal(leadVocals.canonicalName, "lead-vocals");
  assert.equal(leadVocals.family, "vocal");
});

test("manual review defaults generic vocals to lead vocals without offering a generic vocals option", () => {
  const providerLabel = inferInstrumentLabel({
    providerLabel: "Vocals",
    detectedFromArtifactId: "stem-994"
  });
  const defaultLabel = defaultManualInstrumentLabelForProviderLabel(providerLabel);

  assert.equal(defaultLabel?.canonicalName, "lead-vocals");
  assert.equal(humanInstrumentReviewOptions().some((option) => option.displayName === "Vocals"), false);
});

test("makeMidiFilename preserves job, order, and instrument label", () => {
  const label = inferInstrumentLabelFromName("Piano", "stem-456");

  assert.equal(makeMidiFilename("job-7", label, 2), "job-7_03_piano.mid");
});
