import type { AudioArtifact, PipelineProviders } from "../pipeline/types.ts";
import { runPipeline } from "../pipeline/workflow.ts";
import { createMockProviders } from "../providers/mock/index.ts";
import type { FileJobStore } from "./fileJobStore.ts";
import type { PipelineJobRecord } from "./types.ts";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PipelineJobRunner {
  private readonly jobStore: FileJobStore;
  readonly providers: PipelineProviders;

  constructor(jobStore: FileJobStore, providers: PipelineProviders = createMockProviders()) {
    this.jobStore = jobStore;
    this.providers = providers;
  }

  start(record: PipelineJobRecord): void {
    void this.run(record.id, record.inputArtifact).catch(async (error: unknown) => {
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
      return await this.jobStore.fail(jobId, { message: errorMessage(error) });
    }
  }
}
