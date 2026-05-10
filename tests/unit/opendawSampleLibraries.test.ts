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

test("sampleLibraryForInstrument maps current SoundFont program targets", () => {
  const cases = [
    { sampleLibraryKey: "studio-drums", canonicalName: "drums", family: "drums" as const, midiProgram: 1, soundfontBank: 128, presetIndex: 0, presetName: "Standard" },
    { sampleLibraryKey: "electric-bass", canonicalName: "bass", family: "bass" as const, midiProgram: 34, presetIndex: 33, presetName: "Finger Bass" },
    { sampleLibraryKey: "clean-electric-guitar", canonicalName: "guitar", family: "guitar" as const, midiProgram: 28, presetIndex: 27, presetName: "Electric Guitar Clean" },
    { sampleLibraryKey: "studio-strings", canonicalName: "strings", family: "strings" as const, midiProgram: 50, presetIndex: 49, presetName: "Stereo Strings Slow" },
    { sampleLibraryKey: "studio-brass", canonicalName: "brass", family: "wind" as const, midiProgram: 62, presetIndex: 61, presetName: "Brass Section" }
  ];

  for (const item of cases) {
    const assignment = sampleLibraryForInstrument({
      canonicalName: item.canonicalName,
      family: item.family,
      confidence: 0.88,
      detectedFromArtifactId: `stem-${item.canonicalName}`,
      method: "provider-native",
      sampleLibraryKey: item.sampleLibraryKey
    });

    assert.equal(assignment.midiProgram, item.midiProgram);
    if ("soundfontBank" in item) {
      assert.equal(assignment.soundfontBank, item.soundfontBank);
      assert.equal(assignment.isPercussion, true);
    }
    assert.equal(assignment.presetIndex, item.presetIndex);
    assert.equal(assignment.presetName, item.presetName);
  }
});

test("knownSampleLibraryKeys includes current ReMuse library keys", () => {
  const keys = knownSampleLibraryKeys();
  assert.equal(keys.includes("analog-synth"), true);
  assert.equal(keys.includes("grand-piano"), true);
  assert.equal(keys.includes("studio-brass"), true);
  assert.equal(keys.includes("studio-drums"), true);
});
