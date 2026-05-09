import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJobServer } from "../../src/server/http.ts";
import { createPcmWavFixture } from "../helpers/wavFixture.ts";

test("job backend accepts WAV upload, tracks state, and exposes mock pipeline result", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-job-server-"));
  const app = createJobServer({ rootDir });
  const upload = createPcmWavFixture();

  const created = (await app.api.createJobFromUpload({
    bytes: upload,
    contentType: "audio/wav",
    filename: "source.wav"
  })) as { jobId: string; statusUrl: string; resultUrl: string };
  assert.match(created.jobId, /^job_/);
  assert.equal(created.statusUrl, `/v1/jobs/${created.jobId}`);

  let status = (await app.api.getJobStatus(created.jobId)) as {
    status: string;
    events: Array<{ step: string; status: string }>;
  };

  for (let attempt = 0; attempt < 20 && status.status !== "succeeded"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    status = (await app.api.getJobStatus(created.jobId)) as typeof status;
  }

  assert.equal(status.status, "succeeded");
  assert.equal(status.events.at(-1)?.step, "opendaw-bounce");
  assert.equal(status.events.at(-1)?.status, "succeeded");

  assert.equal(created.resultUrl, `/v1/jobs/${created.jobId}/result`);
  const result = (await app.api.getJobResult(created.jobId)) as {
    jobId: string;
    inputAudio: { filename: string };
    midi: { midiFiles: Array<{ filename: string }> };
    bounce: { bounce: { filename: string; format: { bitDepth: number } } };
  };

  assert.equal(result.jobId, created.jobId);
  assert.equal(result.inputAudio.filename, "source.wav");
  assert.ok(result.midi.midiFiles.every((file) => file.filename.endsWith(".mid")));
  assert.equal(result.bounce.bounce.filename.endsWith(".bounce.wav"), true);
  assert.equal(result.bounce.bounce.format.bitDepth, 16);
});
