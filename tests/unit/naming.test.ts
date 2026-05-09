import assert from "node:assert/strict";
import test from "node:test";
import { inferInstrumentLabelFromName, makeMidiFilename, normalizeInstrumentName } from "../../src/pipeline/naming.ts";

test("normalizeInstrumentName creates stable filename-safe labels", () => {
  assert.equal(normalizeInstrumentName("  Clean Guitar!! "), "clean-guitar");
  assert.equal(normalizeInstrumentName(""), "unknown-instrument");
});

test("inferInstrumentLabelFromName maps common names to sample libraries", () => {
  const label = inferInstrumentLabelFromName("stem-03.clean-guitar.aiff", "stem-123");

  assert.equal(label.canonicalName, "clean-guitar");
  assert.equal(label.family, "guitar");
  assert.equal(label.sampleLibraryKey, "clean-electric-guitar");
});

test("makeMidiFilename preserves job, order, and instrument label", () => {
  const label = inferInstrumentLabelFromName("Piano", "stem-456");

  assert.equal(makeMidiFilename("job-7", label, 2), "job-7_03_piano.mid");
});
