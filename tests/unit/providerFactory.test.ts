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
