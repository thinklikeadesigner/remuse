import type { AudioArtifact, PendingInstrumentReview, PipelineJobResult, PipelineStepEvent } from "../pipeline/types.ts";

export type JobStatus = "queued" | "running" | "awaiting-review" | "succeeded" | "failed" | "cancelled";

export type JobError = {
  message: string;
  code?: string;
};

export type PipelineJobRecord = {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  inputArtifact: AudioArtifact & { kind: "input-audio" };
  events: PipelineStepEvent[];
  pendingInstrumentReview?: PendingInstrumentReview;
  result?: PipelineJobResult;
  error?: JobError;
};

export type CreateJobRecordInput = {
  id: string;
  inputArtifact: AudioArtifact & { kind: "input-audio" };
};
