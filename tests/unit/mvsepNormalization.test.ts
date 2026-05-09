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

  assert.equal(label.canonicalName, "electric-bass");
  assert.equal(label.family, "bass");
  assert.equal(label.method, "provider-native");
  assert.equal(label.sampleLibraryKey, "electric-bass");
});

test("sortMvsepStemFiles keeps predictable musical stem order", () => {
  const files = extractMvsepFiles({
    data: {
      files: [
        { label: "piano", url: "https://cdn.example.test/piano.wav" },
        { label: "vocals", url: "https://cdn.example.test/vocals.wav" },
        { label: "drums", url: "https://cdn.example.test/drums.wav" }
      ]
    }
  });

  assert.deepEqual(
    sortMvsepStemFiles(files).map((file) => file.label),
    ["vocals", "drums", "piano"]
  );
});
