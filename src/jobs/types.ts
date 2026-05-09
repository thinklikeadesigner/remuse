import type { AudioArtifact, PipelineJobResult, PipelineStepEvent } from "../pipeline/types.ts";

export type JobStatus = "queued" | "running" | "succeeded" | "failed";

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
  result?: PipelineJobResult;
  error?: JobError;
};

export type CreateJobRecordInput = {
  id: string;
  inputArtifact: AudioArtifact & { kind: "input-audio" };
};
