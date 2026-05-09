import { runPipeline } from "../pipeline/workflow.ts";
import { createMockAudioArtifact } from "../providers/mock/artifacts.ts";
import { createMockProviders } from "../providers/mock/index.ts";

const jobId = "demo-job-001";

const result = await runPipeline(
  {
    jobId,
    inputAudio: createMockAudioArtifact({
      kind: "input-audio",
      filename: "uploaded-mix.wav",
      durationSeconds: 142,
      metadata: {
        uploadedBy: "demo-user"
      }
    })
  },
  createMockProviders()
);

console.log(
  JSON.stringify(
    {
      jobId: result.jobId,
      dryTrack: result.dereverb.dryOnly.filename,
      reverbTrack: result.dereverb.reverbOnly.filename,
      stems: result.instrumentStems.map((item) => ({
        file: item.stem.filename,
        instrument: item.label?.canonicalName,
        confidence: item.label?.confidence
      })),
      midiFiles: result.midi.midiFiles.map((file) => file.filename),
      opendawSession: result.opendaw.session.filename,
      finalBounce: result.bounce.bounce.filename,
      eventCount: result.events.length
    },
    null,
    2
  )
);
