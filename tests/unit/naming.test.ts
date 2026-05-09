import assert from "node:assert/strict";
import test from "node:test";
import {
  inferInstrumentLabel,
  inferInstrumentLabelFromName,
  instrumentNameCandidateFromFilename,
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

  assert.equal(label.canonicalName, "clean-guitar");
  assert.equal(label.family, "guitar");
  assert.equal(label.sampleLibraryKey, "clean-electric-guitar");
});

test("instrumentNameCandidateFromFilename extracts provider stem suffixes", () => {
  assert.equal(
    instrumentNameCandidateFromFilename("20260509183642-song_bs6stem_mt_0_instrum.wav"),
    "instrum"
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

  assert.equal(label.canonicalName, "electric-bass");
  assert.equal(label.method, "provider-native");
  assert.equal(label.sampleLibraryKey, "electric-bass");
  assert.equal(needsHumanInstrumentReview(label), false);
});

test("manual review options cover non-MVSEP instrument choices", () => {
  assert.deepEqual(
    humanInstrumentReviewOptions().map((option) => option.displayName),
    ["Brass", "Woodwinds", "Percussion", "Strings", "Organ", "Synthesizer"]
  );

  const label = labelForManualInstrumentSelection("Synthesizer", "stem-999");
  assert.equal(label.canonicalName, "synth");
  assert.equal(label.family, "synth");
  assert.equal(label.method, "manual");
  assert.equal(label.sampleLibraryKey, "analog-synth");
});

test("makeMidiFilename preserves job, order, and instrument label", () => {
  const label = inferInstrumentLabelFromName("Piano", "stem-456");

  assert.equal(makeMidiFilename("job-7", label, 2), "job-7_03_piano.mid");
});
