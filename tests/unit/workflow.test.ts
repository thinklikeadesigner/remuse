import assert from "node:assert/strict";
import test from "node:test";
import { ManualInstrumentReviewRequiredError, runPipeline } from "../../src/pipeline/workflow.ts";
import { createMockAudioArtifact } from "../../src/providers/mock/artifacts.ts";
import { createMockProviders } from "../../src/providers/mock/index.ts";

test("runPipeline bypasses only de-reverb and still invokes instrument stem separation", async () => {
  const inputAudio = createMockAudioArtifact({
    kind: "input-audio",
    filename: "source.wav",
    durationSeconds: 12
  });
  const providers = createMockProviders();
  let stemSeparationInput: Parameters<typeof providers.instrumentStemSeparation.separateInstruments>[0] | undefined;

  providers.dereverb = {
    async splitReverb() {
      throw new Error("De-reverb provider should not be called while bypass is active.");
    }
  };
  providers.instrumentStemSeparation = {
    async separateInstruments(sourceAudio) {
      stemSeparationInput = sourceAudio;
      return [
        {
          stem: createMockAudioArtifact({
            kind: "instrument-stem",
            filename: "source.stem-01.piano.wav",
            sourceArtifactIds: [sourceAudio.id],
            durationSeconds: sourceAudio.durationSeconds,
            metadata: {
              provider: "test-stem-separation"
            }
          })
        }
      ];
    }
  };

  let reviewError: unknown;
  try {
    await runPipeline(
      {
        jobId: "job-workflow-bypass",
        inputAudio
      },
      providers
    );
  } catch (error: unknown) {
    reviewError = error;
  }

  assert.ok(reviewError instanceof ManualInstrumentReviewRequiredError);
  assert.equal(stemSeparationInput?.uri, inputAudio.uri);
  assert.equal(stemSeparationInput?.filename, inputAudio.filename);
  assert.equal(stemSeparationInput?.id, inputAudio.id);
  assert.equal(stemSeparationInput?.kind, "input-audio");
  assert.equal(reviewError.state.dereverb, undefined);
  assert.equal(reviewError.state.events.find((event) => event.step === "de-reverb")?.status, "skipped");
  assert.equal(reviewError.state.events.filter((event) => event.step === "instrument-stem-separation").at(-1)?.status, "succeeded");
  assert.equal(reviewError.state.instrumentStems.length, 1);
  assert.equal(reviewError.reviewStems.length, 1);
});
