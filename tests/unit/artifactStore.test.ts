import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

test("FileArtifactStore persists MIDI artifacts with normalized instrument metadata", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-midi-artifacts-"));
  const store = new FileArtifactStore({ rootDir });
  const midiBytes = Buffer.from([0x4d, 0x54, 0x68, 0x64]);
  const stored = await store.saveMidiArtifact({
    jobId: "job-midi",
    stage: "midi",
    filename: "Job MIDI 01 Bass.MIDI",
    bytes: midiBytes,
    sourceArtifactIds: ["stem-1"],
    instrument: {
      canonicalName: "bass",
      family: "bass",
      confidence: 0.88,
      detectedFromArtifactId: "stem-1",
      method: "provider-native"
    },
    metadata: {
      provider: "http-midi-conversion"
    }
  });

  assert.equal(stored.artifact.kind, "midi");
  assert.equal(stored.artifact.filename, "job-midi-01-bass.mid");
  assert.equal(stored.artifact.instrument.canonicalName, "bass");
  assert.equal(stored.artifact.metadata.normalizedInstrument, "bass");
  assert.equal(stored.artifact.metadata.byteLength, midiBytes.length);
  assert.deepEqual(await readFile(fileURLToPath(stored.artifact.uri)), midiBytes);
});

test("FileArtifactStore persists OpenDAW session artifacts", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-opendaw-artifacts-"));
  const store = new FileArtifactStore({ rootDir });
  const sessionBytes = Buffer.from(JSON.stringify({ schemaVersion: "remuse.opendaw-session.v1", tracks: [] }), "utf8");
  const stored = await store.saveOpenDawSessionArtifact({
    jobId: "job-opendaw",
    stage: "opendaw-session",
    filename: "Job OpenDAW.OPENDaw.JSON",
    bytes: sessionBytes,
    sourceArtifactIds: ["midi-1"],
    sessionId: "session-1",
    trackCount: 2,
    metadata: {
      provider: "local-opendaw-session"
    }
  });

  assert.equal(stored.artifact.kind, "opendaw-session");
  assert.equal(stored.artifact.filename, "job-opendaw.opendaw.json");
  assert.equal(stored.artifact.sessionId, "session-1");
  assert.equal(stored.artifact.trackCount, 2);
  assert.equal(stored.artifact.metadata.provider, "local-opendaw-session");
  assert.equal(stored.artifact.metadata.byteLength, sessionBytes.length);
  assert.deepEqual(await readFile(fileURLToPath(stored.artifact.uri)), sessionBytes);
});
