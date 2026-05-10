import assert from "node:assert/strict";
import test from "node:test";
import { knownSampleLibraryKeys, sampleLibraryForInstrument } from "../../src/providers/opendaw/sampleLibraries.ts";

test("sampleLibraryForInstrument maps normalized instrument keys to OpenDAW targets", () => {
  const assignment = sampleLibraryForInstrument({
    canonicalName: "piano",
    family: "keys",
    confidence: 0.88,
    detectedFromArtifactId: "stem-1",
    method: "provider-native",
    midiProgram: 1,
    sampleLibraryKey: "grand-piano"
  });

  assert.equal(assignment.key, "grand-piano");
  assert.equal(assignment.engine, "opendaw-soundfont");
  assert.equal(assignment.presetName, "Acoustic Grand Piano");
  assert.equal(assignment.midiProgram, 1);
});

test("sampleLibraryForInstrument falls back when no key is present", () => {
  const assignment = sampleLibraryForInstrument({
    canonicalName: "other",
    family: "unknown",
    confidence: 0.4,
    detectedFromArtifactId: "stem-2",
    method: "provider-native"
  });

  assert.equal(assignment.key, "general-midi-fallback");
  assert.equal(assignment.engine, "general-midi-fallback");
  assert.equal(assignment.family, "unknown");
  assert.match(assignment.fallbackReason ?? "", /No explicit sample library/);
});

test("knownSampleLibraryKeys includes current ReMuse library keys", () => {
  const keys = knownSampleLibraryKeys();
  assert.equal(keys.includes("analog-synth"), true);
  assert.equal(keys.includes("grand-piano"), true);
  assert.equal(keys.includes("studio-drums"), true);
});
