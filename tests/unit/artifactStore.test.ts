import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileArtifactStore } from "../../src/storage/fileArtifactStore.ts";
import { createPcmWavFixture } from "../helpers/wavFixture.ts";

test("FileArtifactStore persists non-input WAV provider artifacts", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-artifacts-"));
  const store = new FileArtifactStore({ rootDir });
  const stored = await store.saveAudioArtifact({
    jobId: "job-test",
    stage: "instrument-stems",
    kind: "instrument-stem",
    filename: "Stem 01 Bass.wav",
    bytes: createPcmWavFixture({ bitDepth: 16 }),
    sourceArtifactIds: ["dry-1"],
    metadata: {
      provider: "mvsep",
      stemIndex: 0
    }
  });

  assert.equal(stored.artifact.kind, "instrument-stem");
  assert.equal(stored.artifact.filename, "stem-01-bass.wav");
  assert.equal(stored.artifact.format.bitDepth, 16);
  assert.equal(stored.artifact.metadata.provider, "mvsep");
  assert.equal(stored.artifact.sourceArtifactIds[0], "dry-1");
});
