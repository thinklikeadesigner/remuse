import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createProvidersFromEnvironment } from "../../src/providers/index.ts";
import { FileArtifactStore } from "../../src/storage/fileArtifactStore.ts";

test("createProvidersFromEnvironment defaults to mock providers", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-provider-factory-"));
  const providers = createProvidersFromEnvironment({
    artifactStore: new FileArtifactStore({ rootDir }),
    env: {}
  });

  assert.equal(providers.dereverb.constructor.name, "MockDereverbProvider");
});

test("createProvidersFromEnvironment requires MVSEP token for mvsep mode", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-provider-factory-"));

  assert.throws(
    () =>
      createProvidersFromEnvironment({
        artifactStore: new FileArtifactStore({ rootDir }),
        env: { REMUSE_PROVIDER: "mvsep" }
      }),
    /MVSEP_API_TOKEN/
  );
});

test("createProvidersFromEnvironment can replace only MIDI conversion with HTTP provider", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-provider-factory-"));
  const providers = createProvidersFromEnvironment({
    artifactStore: new FileArtifactStore({ rootDir }),
    env: {
      REMUSE_MIDI_PROVIDER: "http",
      MIDI_CONVERSION_BASE_URL: "https://midi.example.test",
      MIDI_CONVERSION_API_TOKEN: "token",
      MIDI_CONVERSION_QUANTIZATION: "nearest-1-480"
    }
  });

  assert.equal(providers.dereverb.constructor.name, "MockDereverbProvider");
  assert.equal(providers.midiConversion.constructor.name, "HttpMidiConversionProvider");
});

test("createProvidersFromEnvironment can replace only MIDI conversion with Basic Pitch provider", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-provider-factory-"));
  const providers = createProvidersFromEnvironment({
    artifactStore: new FileArtifactStore({ rootDir }),
    env: {
      REMUSE_PROVIDER: "mvsep",
      MVSEP_API_TOKEN: "mvsep-token",
      REMUSE_MIDI_PROVIDER: "basic-pitch",
      BASIC_PITCH_COMMAND: "basic-pitch-test",
      BASIC_PITCH_MODEL_SERIALIZATION: "onnx"
    }
  });

  assert.equal(providers.dereverb.constructor.name, "MvsepDereverbProvider");
  assert.equal(providers.midiConversion.constructor.name, "BasicPitchMidiConversionProvider");
});

test("createProvidersFromEnvironment rejects Basic Pitch with pure mock upstream artifacts", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-provider-factory-"));

  assert.throws(
    () =>
      createProvidersFromEnvironment({
        artifactStore: new FileArtifactStore({ rootDir }),
        env: { REMUSE_MIDI_PROVIDER: "basic-pitch" }
      }),
    /file-backed stems/
  );
});

test("createProvidersFromEnvironment requires MIDI HTTP endpoint settings", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-provider-factory-"));

  assert.throws(
    () =>
      createProvidersFromEnvironment({
        artifactStore: new FileArtifactStore({ rootDir }),
        env: { REMUSE_MIDI_PROVIDER: "http" }
      }),
    /MIDI_CONVERSION_BASE_URL/
  );
});

test("createProvidersFromEnvironment validates Basic Pitch model serialization", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-provider-factory-"));

  assert.throws(
    () =>
      createProvidersFromEnvironment({
        artifactStore: new FileArtifactStore({ rootDir }),
        env: {
          REMUSE_PROVIDER: "mvsep",
          MVSEP_API_TOKEN: "mvsep-token",
          REMUSE_MIDI_PROVIDER: "basic-pitch",
          BASIC_PITCH_MODEL_SERIALIZATION: "surprise"
        }
      }),
    /BASIC_PITCH_MODEL_SERIALIZATION/
  );
});
