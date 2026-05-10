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
  assert.equal(assignment.presetName, "Stereo Grand");
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
    { sampleLibraryKey: "lead-vocal-synth", canonicalName: "lead-vocals", family: "vocal" as const, midiProgram: 86, presetIndex: 85, presetName: "Solo Vox" },
    { sampleLibraryKey: "backing-vocal-synth", canonicalName: "back-vocals", family: "vocal" as const, midiProgram: 54, presetIndex: 53, presetName: "Voice Oohs" },
    { sampleLibraryKey: "vocal-synth", canonicalName: "vocals", family: "vocal" as const, midiProgram: 86, presetIndex: 85, presetName: "Solo Vox" },
    { sampleLibraryKey: "studio-drums", canonicalName: "drums", family: "drums" as const, midiProgram: 33, soundfontBank: 128, presetIndex: 32, presetName: "Jazz" },
    { sampleLibraryKey: "electric-bass", canonicalName: "bass", family: "bass" as const, midiProgram: 33, presetIndex: 32, presetName: "Acoustic Bass" },
    { sampleLibraryKey: "clean-electric-guitar", canonicalName: "guitar", family: "guitar" as const, midiProgram: 27, presetIndex: 26, presetName: "Jazz Guitar" },
    { sampleLibraryKey: "studio-strings", canonicalName: "strings", family: "strings" as const, midiProgram: 49, presetIndex: 48, presetName: "Stereo Strings Fast" },
    { sampleLibraryKey: "studio-brass", canonicalName: "brass", family: "wind" as const, midiProgram: 62, presetIndex: 61, presetName: "Brass Section" },
    { sampleLibraryKey: "studio-winds", canonicalName: "woodwinds", family: "wind" as const, midiProgram: 67, presetIndex: 66, presetName: "Tenor Sax" },
    { sampleLibraryKey: "analog-synth", canonicalName: "synth", family: "synth" as const, midiProgram: 90, presetIndex: 89, presetName: "Warm Pad" },
    { sampleLibraryKey: "world-percussion", canonicalName: "percussion", family: "percussion" as const, midiProgram: 33, soundfontBank: 128, presetIndex: 32, presetName: "Jazz" }
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
