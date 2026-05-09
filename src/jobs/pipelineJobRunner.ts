import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createNonSilentReviewClip } from "../audio/reviewClip.ts";
import type { AudioArtifact, HumanInstrumentReviewRequest, PendingInstrumentReview, PipelineProviders } from "../pipeline/types.ts";
import { humanInstrumentReviewOptions } from "../pipeline/naming.ts";
import { continuePipelineFromManualReview, ManualInstrumentReviewRequiredError, runPipeline } from "../pipeline/workflow.ts";
import { createMockProviders } from "../providers/mock/index.ts";
import type { FileArtifactStore } from "../storage/fileArtifactStore.ts";
import type { FileJobStore } from "./fileJobStore.ts";
import type { PipelineJobRecord } from "./types.ts";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PipelineJobRunner {
  private readonly jobStore: FileJobStore;
  private readonly artifactStore: FileArtifactStore;
  readonly providers: PipelineProviders;

  constructor(
    jobStore: FileJobStore,
    artifactStore: FileArtifactStore,
    providers: PipelineProviders = createMockProviders()
  ) {
    this.jobStore = jobStore;
    this.artifactStore = artifactStore;
    this.providers = providers;
  }

  start(record: PipelineJobRecord): void {
    void this.run(record.id, record.inputArtifact).catch(async (error: unknown) => {
      await this.jobStore.fail(record.id, { message: errorMessage(error) });
    });
  }

  startResume(record: PipelineJobRecord): void {
    const pending = record.pendingInstrumentReview;
    if (pending === undefined) {
      void this.jobStore.fail(record.id, { message: "Cannot resume manual review without pending review state." });
      return;
    }

    void this.resumeFromManualReview(record.id, pending).catch(async (error: unknown) => {
      await this.jobStore.fail(record.id, { message: errorMessage(error) });
    });
  }

  async run(jobId: string, inputArtifact: AudioArtifact & { kind: "input-audio" }): Promise<PipelineJobRecord> {
    await this.jobStore.setStatus(jobId, "running");

    try {
      const result = await runPipeline(
        {
          jobId,
          inputAudio: inputArtifact
        },
        this.providers,
        {
          onEvent: async (event) => {
            await this.jobStore.appendEvent(jobId, event);
          }
        }
      );

      return await this.jobStore.complete(jobId, result);
    } catch (error: unknown) {
      if (error instanceof ManualInstrumentReviewRequiredError) {
        return this.awaitManualInstrumentReview(jobId, error);
      }

      return await this.jobStore.fail(jobId, { message: errorMessage(error) });
    }
  }

  async resumeFromManualReview(jobId: string, pending: PendingInstrumentReview): Promise<PipelineJobRecord> {
    await this.jobStore.updatePendingInstrumentReview(jobId, pending, "running");

    try {
      const result = await continuePipelineFromManualReview(pending.state, pending.requests, this.providers, {
        onEvent: async (event) => {
          await this.jobStore.appendEvent(jobId, event);
        }
      });

      return await this.jobStore.complete(jobId, result);
    } catch (error: unknown) {
      return await this.jobStore.fail(jobId, { message: errorMessage(error) });
    }
  }

  private async awaitManualInstrumentReview(
    jobId: string,
    error: ManualInstrumentReviewRequiredError
  ): Promise<PipelineJobRecord> {
    const requests = await Promise.all(error.reviewStems.map((stem) => this.createReviewRequest(jobId, stem)));
    const awaitingEvent = {
      step: "manual-instrument-review" as const,
      status: "awaiting-input" as const,
      message: `Waiting for user labels on ${requests.length} non-specific stem(s).`,
      at: new Date().toISOString()
    };
    error.state.events.push(awaitingEvent);
    await this.jobStore.appendEvent(jobId, awaitingEvent);

    return this.jobStore.awaitReview(jobId, {
      state: error.state,
      requests
    });
  }

  private async createReviewRequest(
    jobId: string,
    stem: ManualInstrumentReviewRequiredError["reviewStems"][number]
  ): Promise<HumanInstrumentReviewRequest> {
    const sourcePath = fileURLToPath(stem.stem.uri);
    const sourceBytes = await readFile(sourcePath);
    const clip = createNonSilentReviewClip(sourceBytes);
    const clipFilename = stem.stem.filename.replace(/\.wav$/i, "") + ".review-clip.wav";
    const stored = await this.artifactStore.saveAudioArtifact({
      jobId,
      stage: "instrument-review",
      kind: "review-clip",
      filename: clipFilename,
      bytes: clip.bytes,
      sourceArtifactIds: [stem.stem.id],
      metadata: {
        clipStartSeconds: Number(clip.startSeconds.toFixed(3)),
        clipDurationSeconds: Number(clip.durationSeconds.toFixed(3)),
        containsAudio: clip.containsAudio
      }
    });

    return {
      id: `${stem.stem.id}-instrument-review`,
      stemArtifactId: stem.stem.id,
      stemFilename: stem.stem.filename,
      currentLabel: stem.label,
      clip: stored.artifact,
      options: humanInstrumentReviewOptions(),
      status: "pending"
    };
  }
}
