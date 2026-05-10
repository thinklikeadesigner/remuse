import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJobServer, renderReviewClosedPage } from "../../src/server/http.ts";
import { parseWavFormat } from "../../src/audio/wav.ts";
import { createProvidersFromEnvironment } from "../../src/providers/index.ts";
import { createMockProviders } from "../../src/providers/mock/index.ts";
import { createPcmWavFixture } from "../helpers/wavFixture.ts";

test("job backend accepts WAV upload, tracks state, and exposes mock pipeline result", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-job-server-"));
  const app = createJobServer({
    rootDir,
    providers: ({ artifactStore }) =>
      createProvidersFromEnvironment({
        artifactStore,
        env: {
          REMUSE_PROVIDER: "mock",
          REMUSE_OPENDAW_PROVIDER: "local-session"
        }
      })
  });
  const upload = createPcmWavFixture();
  const uploadParsed = parseWavFormat(upload);

  const created = (await app.api.createJobFromUpload({
    bytes: upload,
    contentType: "audio/wav",
    filename: "source.wav"
  })) as { jobId: string; statusUrl: string; resultUrl: string; reviewUrl: string };
  assert.match(created.jobId, /^job_/);
  assert.equal(created.statusUrl, `/v1/jobs/${created.jobId}`);
  assert.equal(created.reviewUrl, `/review/${created.jobId}`);

  let status = (await app.api.getJobStatus(created.jobId)) as {
    status: string;
    events: Array<{ step: string; status: string }>;
    pendingInstrumentReviews: Array<{ id: string; selectedLabel?: { canonicalName: string }; currentLabel: { canonicalName: string } }>;
  };

  for (let attempt = 0; attempt < 20 && status.status !== "awaiting-review"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    status = (await app.api.getJobStatus(created.jobId)) as typeof status;
  }

  assert.equal(status.status, "awaiting-review");
  await app.api.completeInstrumentReview(
    created.jobId,
    new Map(
      status.pendingInstrumentReviews.map((request) => [
        request.id,
        { discard: false, selection: request.selectedLabel?.canonicalName ?? request.currentLabel.canonicalName }
      ])
    )
  );

  for (let attempt = 0; attempt < 20 && status.status !== "succeeded"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    status = (await app.api.getJobStatus(created.jobId)) as typeof status;
  }

  assert.equal(status.status, "succeeded");
  assert.equal(status.events.find((event) => event.step === "de-reverb")?.status, "skipped");
  assert.equal(status.events.at(-1)?.step, "opendaw-bounce");
  assert.equal(status.events.at(-1)?.status, "succeeded");

  assert.equal(created.resultUrl, `/v1/jobs/${created.jobId}/result`);
  const result = (await app.api.getJobResult(created.jobId)) as {
    jobId: string;
    inputAudio: { filename: string };
    midi: { midiFiles: Array<{ filename: string }> };
    bounce: { bounce: { filename: string; format: { bitDepth: number }; metadata: Record<string, unknown> } };
  };

  assert.equal(result.jobId, created.jobId);
  assert.equal(result.inputAudio.filename, "source.wav");
  assert.ok(result.midi.midiFiles.every((file) => file.filename.endsWith(".mid")));
  assert.equal(result.bounce.bounce.filename.endsWith(".bounce.wav"), true);
  assert.equal(result.bounce.bounce.format.bitDepth, 16);

  const bounce = await app.api.getJobBounce(created.jobId);
  assert.equal(bounce.filename, result.bounce.bounce.filename);
  const bounceParsed = parseWavFormat(bounce.bytes);
  assert.equal(bounceParsed.format.bitDepth, 16);
  assert.equal(bounceParsed.dataBytes, uploadParsed.dataBytes);
  assert.equal(result.bounce.bounce.metadata.renderDurationNormalized, true);
  assert.equal(result.bounce.bounce.metadata.targetFrameCount, 8);
});

test("review page shows live progress while a job is active", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-job-progress-"));
  const providers = createMockProviders();
  const originalStemSeparation = providers.instrumentStemSeparation;
  let releaseStemSeparation: () => void = () => undefined;
  const stemSeparationGate = new Promise<void>((resolve) => {
    releaseStemSeparation = resolve;
  });
  providers.instrumentStemSeparation = {
    async separateInstruments(dryOnly, context) {
      await stemSeparationGate;
      return originalStemSeparation.separateInstruments(dryOnly, context);
    }
  };
  const app = createJobServer({ rootDir, providers });

  const created = (await app.api.createJobFromUpload({
    bytes: createPcmWavFixture(),
    contentType: "audio/wav",
    filename: "source.wav"
  })) as { jobId: string };

  try {
    let status = (await app.api.getJobStatus(created.jobId)) as {
      status: string;
      events: Array<{ step: string; status: string }>;
    };

    for (let attempt = 0; attempt < 20 && status.events.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      status = (await app.api.getJobStatus(created.jobId)) as typeof status;
    }

    assert.equal(status.status, "running");

    const reviewPage = await app.api.getInstrumentReviewPage(created.jobId);
    assert.match(reviewPage, /<section class="progress-dialog" role="status"/);
    assert.match(reviewPage, /<progress max="100" value="/);
    assert.match(reviewPage, /--bg: #090909/);
    assert.match(reviewPage, /linear-gradient\(90deg, var\(--red\), var\(--gold\), var\(--green\)\)/);
    assert.match(reviewPage, /This page refreshes while the job is active\./);
  } finally {
    releaseStemSeparation();
  }
});

test("job backend pauses for human review of non-specific stems and resumes after selection", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-manual-review-"));
  const openedUrls: string[] = [];
  const app = createJobServer({
    rootDir,
    publicBaseUrl: "http://remuse.test",
    autoOpenReview: true,
    openUrl: (url) => {
      openedUrls.push(url);
    },
    providers: ({ artifactStore }) => {
      const providers = createMockProviders();
      providers.instrumentStemSeparation = {
        async separateInstruments(dryOnly, context) {
          const createReviewStem = async (index: number, providerLabel: string) => {
            const bytes = createPcmWavFixture({ frames: 44100 * 8 });
            const audibleFrame = 44100 * 3;
            bytes.writeInt16LE(12000 + index, 44 + audibleFrame * 2 * 2);
            bytes.writeInt16LE(12000 + index, 44 + (audibleFrame * 2 + 1) * 2);
            const stored = await artifactStore.saveAudioArtifact({
              jobId: context.jobId,
              stage: "instrument-stems",
              kind: "instrument-stem",
              filename: `source.stem-0${index}.${providerLabel.toLowerCase()}.wav`,
              bytes,
              sourceArtifactIds: [dryOnly.id],
              metadata: {
                provider: "test-stem-provider",
                providerLabel
              }
            });

            return { stem: stored.artifact };
          };

          return [await createReviewStem(1, "Bass"), await createReviewStem(2, "Vocals"), await createReviewStem(3, "Other")];
        }
      };

      return providers;
    }
  });

  const created = (await app.api.createJobFromUpload({
    bytes: createPcmWavFixture(),
    contentType: "audio/wav",
    filename: "source.wav"
  })) as { jobId: string };
  assert.deepEqual(openedUrls, []);

  let status = (await app.api.getJobStatus(created.jobId)) as {
    status: string;
    pendingInstrumentReviews: Array<{
      id: string;
      selectedLabel?: { canonicalName: string };
      clip: { metadata: { clipStartSeconds: number; containsAudio: boolean } };
      currentLabel: { canonicalName: string };
      options: Array<{ displayName: string }>;
    }>;
  };

  for (let attempt = 0; attempt < 20 && (status.status !== "awaiting-review" || openedUrls.length === 0); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    status = (await app.api.getJobStatus(created.jobId)) as typeof status;
  }

  assert.equal(status.status, "awaiting-review");
  assert.deepEqual(openedUrls, [`http://remuse.test/review/${created.jobId}`]);
  assert.equal(status.pendingInstrumentReviews.length, 3);
  assert.deepEqual(
    status.pendingInstrumentReviews[0]?.options.map((option) => option.displayName),
    [
      "Lead Vocals",
      "Backing Vocals",
      "Drums",
      "Bass",
      "Guitar",
      "Piano",
      "Brass",
      "Woodwinds",
      "Strings",
      "Percussion",
      "Organ",
      "Synthesizer"
    ]
  );
  assert.equal(status.pendingInstrumentReviews[0]?.clip.metadata.containsAudio, true);
  assert.equal(status.pendingInstrumentReviews[0]?.clip.metadata.clipStartSeconds, 0);
  assert.equal(status.pendingInstrumentReviews[0]?.selectedLabel?.canonicalName, "bass");
  assert.equal(status.pendingInstrumentReviews[1]?.currentLabel.canonicalName, "vocals");
  assert.equal(status.pendingInstrumentReviews[1]?.selectedLabel?.canonicalName, "lead-vocals");
  assert.equal(status.pendingInstrumentReviews[2]?.selectedLabel, undefined);

  const reviewId = status.pendingInstrumentReviews[0]?.id;
  const vocalsReviewId = status.pendingInstrumentReviews[1]?.id;
  const discardReviewId = status.pendingInstrumentReviews[2]?.id;
  if (reviewId === undefined || vocalsReviewId === undefined || discardReviewId === undefined) {
    throw new Error("Expected three pending review IDs.");
  }
  const reviewPage = await app.api.getInstrumentReviewPage(created.jobId);
  assert.match(reviewPage, /<audio controls/);
  assert.match(reviewPage, new RegExp(reviewId));
  assert.match(reviewPage, new RegExp(vocalsReviewId));
  assert.match(reviewPage, new RegExp(discardReviewId));
  assert.match(reviewPage, /<option value="Organ">Organ<\/option>/);
  assert.match(reviewPage, /<button class="discard-button" type="button" data-discard-button>Discard<\/button>/);
  assert.match(reviewPage, new RegExp(`/review/${created.jobId}/complete`));
  assert.match(reviewPage, /Complete Review/);
  assert.match(reviewPage, /window\.confirm\("You are about to discard this ReMuse - are you sure\?"\)/);

  const clip = await app.api.getInstrumentReviewClip(created.jobId, reviewId);
  assert.equal(parseWavFormat(clip.bytes).durationSeconds, 8);

  await app.api.completeInstrumentReview(
    created.jobId,
    new Map([
      [reviewId, { discard: false, selection: "Guitar" }],
      [vocalsReviewId, { discard: false, selection: "Lead Vocals" }],
      [discardReviewId, { discard: true }]
    ])
  );
  const closePage = renderReviewClosedPage(created.jobId);
  assert.match(closePage, /Manual Review Complete/);
  assert.match(closePage, /window\.close\(\)/);

  let resumedStatus = (await app.api.getJobStatus(created.jobId)) as { status: string };
  for (let attempt = 0; attempt < 20 && resumedStatus.status !== "succeeded"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    resumedStatus = (await app.api.getJobStatus(created.jobId)) as typeof resumedStatus;
  }

  assert.equal(resumedStatus.status, "succeeded");
  assert.equal(openedUrls.length, 1);

  const result = (await app.api.getJobResult(created.jobId)) as {
    manualReviews: Array<{ status: string; selectedLabel?: { canonicalName: string } }>;
    instrumentStems: Array<{ stem: { filename: string; uri: string; metadata: Record<string, unknown> }; label?: { canonicalName: string } }>;
    midi: { midiFiles: Array<{ filename: string }> };
  };

  assert.equal(result.manualReviews[0]?.selectedLabel?.canonicalName, "guitar");
  assert.equal(result.manualReviews[1]?.selectedLabel?.canonicalName, "lead-vocals");
  assert.equal(result.manualReviews[2]?.status, "discarded");
  assert.equal(result.instrumentStems.length, 2);
  assert.equal(result.instrumentStems[0]?.stem.filename.endsWith(".guitar.wav"), true);
  assert.equal(result.instrumentStems[0]?.stem.metadata.normalizedInstrument, "guitar");
  assert.equal(result.instrumentStems[0]?.label?.canonicalName, "guitar");
  assert.equal(result.midi.midiFiles.length, 2);
  assert.equal(result.midi.midiFiles[0]?.filename.endsWith("_guitar.mid"), true);
  assert.equal(result.midi.midiFiles[1]?.filename.endsWith("_lead-vocals.mid"), true);
});

test("manual review can cancel a job when every stem is discarded", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-manual-review-cancel-"));
  const app = createJobServer({
    rootDir,
    providers: createMockProviders()
  });

  const created = (await app.api.createJobFromUpload({
    bytes: createPcmWavFixture(),
    contentType: "audio/wav",
    filename: "source.wav"
  })) as { jobId: string };

  let status = (await app.api.getJobStatus(created.jobId)) as {
    status: string;
    pendingInstrumentReviews: Array<{ id: string }>;
    error?: { message: string };
  };

  for (let attempt = 0; attempt < 20 && status.status !== "awaiting-review"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    status = (await app.api.getJobStatus(created.jobId)) as typeof status;
  }

  assert.equal(status.status, "awaiting-review");
  assert.ok(status.pendingInstrumentReviews.length > 0);

  const cancelled = (await app.api.completeInstrumentReview(
    created.jobId,
    new Map(status.pendingInstrumentReviews.map((request) => [request.id, { discard: true }]))
  )) as { status: string; error?: { message: string } };

  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.error?.message, "All stems were discarded during manual review.");

  status = (await app.api.getJobStatus(created.jobId)) as typeof status;
  assert.equal(status.status, "cancelled");
  assert.equal(status.error?.message, "All stems were discarded during manual review.");
});
