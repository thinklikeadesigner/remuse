import assert from "node:assert/strict";
import test from "node:test";
import {
  extractMvsepFiles,
  normalizeMvsepStemLabel,
  selectDereverbFiles,
  sortMvsepStemFiles
} from "../../src/providers/mvsep/normalization.ts";

test("extractMvsepFiles accepts object-shaped MVSEP file maps", () => {
  const files = extractMvsepFiles(
    {
      data: {
        files: {
          noreverb: { url: "/download/no_reverb.wav", name: "no_reverb.wav" },
          reverb: { download_url: "https://cdn.example.test/reverb.wav" }
        }
      }
    },
    "https://mvsep.com"
  );

  assert.equal(files.length, 2);
  assert.equal(files[0]?.url, "https://mvsep.com/download/no_reverb.wav");
  assert.equal(files[0]?.filename, "no_reverb.wav");
});

test("selectDereverbFiles finds dry and reverb artifacts by provider names", () => {
  const files = extractMvsepFiles(
    {
      data: {
        files: [
          { label: "noreverb", url: "https://cdn.example.test/song.noreverb.wav" },
          { label: "reverb", url: "https://cdn.example.test/song.reverb.wav" }
        ]
      }
    },
    "https://mvsep.com"
  );

  const selected = selectDereverbFiles(files);

  assert.equal(selected.dryOnly?.label, "noreverb");
  assert.equal(selected.reverbOnly?.label, "reverb");
});

test("normalizeMvsepStemLabel maps provider labels to Remuse labels", () => {
  const label = normalizeMvsepStemLabel({
    providerLabel: "bass",
    filename: "song.bass.wav",
    detectedFromArtifactId: "stem-1"
  });

  assert.equal(label.canonicalName, "bass");
  assert.equal(label.family, "bass");
  assert.equal(label.method, "provider-native");
  assert.equal(label.sampleLibraryKey, "electric-bass");
});

test("normalizeMvsepStemLabel uses MVSEP filenames when labels are sparse", () => {
  const label = normalizeMvsepStemLabel({
    filename: "20260509183642-song_bs6stem_mt_0_guitar.wav",
    detectedFromArtifactId: "stem-2"
  });

  assert.equal(label.canonicalName, "guitar");
  assert.equal(label.family, "guitar");
  assert.equal(label.method, "provider-native");
});

test("normalizeMvsepStemLabel keeps MVSEP instrumental and other stems low confidence", () => {
  const instrumental = normalizeMvsepStemLabel({
    providerLabel: "Instrum",
    filename: "20260509183642-song_bs6stem_mt_0_instrum.wav",
    detectedFromArtifactId: "stem-3"
  });
  const other = normalizeMvsepStemLabel({
    providerLabel: "Other",
    filename: "20260509183642-song_bs6stem_mt_0_other.wav",
    detectedFromArtifactId: "stem-4"
  });

  assert.equal(instrumental.canonicalName, "instrumental");
  assert.equal(instrumental.family, "unknown");
  assert.equal(instrumental.confidence, 0.45);
  assert.equal(other.canonicalName, "other");
  assert.equal(other.confidence, 0.45);
});

test("sortMvsepStemFiles keeps predictable musical stem order", () => {
  const files = extractMvsepFiles({
    data: {
      files: [
        { label: "other", url: "https://cdn.example.test/other.wav" },
        { label: "piano", url: "https://cdn.example.test/piano.wav" },
        { label: "guitar", url: "https://cdn.example.test/guitar.wav" },
        { label: "vocals", url: "https://cdn.example.test/vocals.wav" },
        { label: "bass", url: "https://cdn.example.test/bass.wav" },
        { label: "drums", url: "https://cdn.example.test/drums.wav" },
        { label: "instrum", url: "https://cdn.example.test/instrum.wav" }
      ]
    }
  });

  assert.deepEqual(
    sortMvsepStemFiles(files).map((file) => file.label),
    ["vocals", "instrum", "bass", "drums", "guitar", "piano", "other"]
  );
});
