import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LalalClient } from "../../src/providers/lalal/client.ts";
import { LalalInstrumentStemSeparationProvider } from "../../src/providers/lalal/providers.ts";
import { FileArtifactStore } from "../../src/storage/fileArtifactStore.ts";
import { createPcmWavFixture } from "../helpers/wavFixture.ts";

type CapturedRequest = {
  pathname: string;
  headers: Headers;
  body?: string;
};

test("LALAL.AI provider uploads source audio, requests multistem WAV, and persists returned stems", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-lalal-provider-"));
  const artifactStore = new FileArtifactStore({ rootDir });
  const input = await artifactStore.saveInputWav("job-lalal", "source.wav", createPcmWavFixture({ frames: 16 }));
  const capturedRequests: CapturedRequest[] = [];
  const wavFixture = createPcmWavFixture({ frames: 16 });
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url) => {
    const href = url instanceof URL ? url.href : String(url);
    if (href.startsWith("https://files.example.test/")) {
      return new Response(new Uint8Array(wavFixture), { status: 200 });
    }

    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    const client = new LalalClient({
      licenseKey: "lalal-license",
      baseUrl: "https://lalal.example.test/api/v1/",
      pollIntervalMs: 0,
      maxPollAttempts: 1,
      fetchImpl: async (url, init) => {
        const parsedUrl = url instanceof URL ? url : new URL(String(url));
        const body = typeof init?.body === "string" ? init.body : undefined;
        capturedRequests.push({
          pathname: parsedUrl.pathname,
          headers: new Headers(init?.headers),
          ...(body === undefined ? {} : { body })
        });

        if (parsedUrl.pathname.endsWith("/upload/")) {
          return Response.json({ id: "source-123", name: "source.wav", size: wavFixture.length, duration: 1, expires: 1_800_000_000 });
        }

        if (parsedUrl.pathname.endsWith("/split/multistem/")) {
          return Response.json({ task_id: "task-123" });
        }

        if (parsedUrl.pathname.endsWith("/check/")) {
          return Response.json({
            result: {
              "task-123": {
                status: "success",
                source_id: "source-123",
                presets: {},
                result: {
                  duration: 1,
                  tracks: [
                    { type: "stem", label: "vocals", url: "https://files.example.test/vocals.wav" },
                    { type: "stem", label: "drum", url: "https://files.example.test/drum.wav" },
                    { type: "back", label: "no_multistem", url: "https://files.example.test/no-multistem.wav" }
                  ]
                }
              }
            }
          });
        }

        return new Response("not found", { status: 404 });
      }
    });
    const provider = new LalalInstrumentStemSeparationProvider(client, artifactStore, {
      stemList: ["vocals", "drum"],
      extractionLevel: "deep_extraction"
    });
    const events: string[] = [];

    const stems = await provider.separateInstruments(input.artifact, {
      jobId: "job-lalal",
      traceId: "trace-job-lalal",
      emit: (event) => {
        events.push(event.message);
      }
    });

    assert.equal(stems.length, 3);
    assert.equal(stems[0]?.label?.canonicalName, "vocals");
    assert.equal(stems[1]?.label?.canonicalName, "drums");
    assert.equal(stems[2]?.label?.canonicalName, "other");
    assert.equal(stems[2]?.label?.family, "unknown");
    assert.equal(stems[0]?.stem.filename, "source.stem-01.vocals.wav");
    assert.equal(stems[1]?.stem.filename, "source.stem-02.drums.wav");
    assert.equal(stems[2]?.stem.filename, "source.stem-03.other.wav");
    assert.equal(stems[0]?.stem.metadata.provider, "lalal");
    assert.equal(stems[0]?.stem.metadata.providerTaskId, "task-123");
    assert.equal(stems[0]?.stem.metadata.providerStemList, "vocals,drum");
    assert.equal(stems[0]?.stem.sourceArtifactIds[0], input.artifact.id);
    assert.ok(events.some((message) => message.includes("uploaded source.wav")));
    assert.ok(events.some((message) => message.includes("multistem job task-123 queued")));

    const uploadRequest = capturedRequests.find((request) => request.pathname.endsWith("/upload/"));
    const splitRequest = capturedRequests.find((request) => request.pathname.endsWith("/split/multistem/"));
    const checkRequest = capturedRequests.find((request) => request.pathname.endsWith("/check/"));

    assert.equal(uploadRequest?.headers.get("X-License-Key"), "lalal-license");
    assert.equal(uploadRequest?.headers.get("Content-Disposition"), 'attachment; filename="source.wav"');
    assert.equal(splitRequest?.headers.get("X-License-Key"), "lalal-license");
    assert.equal(checkRequest?.headers.get("X-License-Key"), "lalal-license");

    const splitBody = JSON.parse(splitRequest?.body ?? "{}") as {
      source_id?: string;
      presets?: {
        splitter?: string;
        encoder_format?: string;
        stem_list?: string[];
        extraction_level?: string;
        dereverb_enabled?: boolean;
      };
      idempotency_key?: string;
    };
    assert.equal(splitBody.source_id, "source-123");
    assert.equal(splitBody.presets?.splitter, "auto");
    assert.equal(splitBody.presets?.encoder_format, "wav");
    assert.deepEqual(splitBody.presets?.stem_list, ["vocals", "drum"]);
    assert.equal(splitBody.presets?.extraction_level, "deep_extraction");
    assert.equal(splitBody.presets?.dereverb_enabled, false);
    assert.match(splitBody.idempotency_key ?? "", /^[0-9a-f-]{36}$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LALAL.AI provider rejects unexpected extra output files", async () => {
  const rootDir = await mkdtemp(join(tmpdir(), "remuse-lalal-provider-extra-"));
  const artifactStore = new FileArtifactStore({ rootDir });
  const input = await artifactStore.saveInputWav("job-lalal-extra", "source.wav", createPcmWavFixture({ frames: 16 }));
  const client = new LalalClient({
    licenseKey: "lalal-license",
    baseUrl: "https://lalal.example.test/api/v1/",
    pollIntervalMs: 0,
    maxPollAttempts: 1,
    fetchImpl: async (url) => {
      const parsedUrl = url instanceof URL ? url : new URL(String(url));

      if (parsedUrl.pathname.endsWith("/upload/")) {
        return Response.json({ id: "source-extra", name: "source.wav", size: 100, duration: 1, expires: 1_800_000_000 });
      }

      if (parsedUrl.pathname.endsWith("/split/multistem/")) {
        return Response.json({ task_id: "task-extra" });
      }

      if (parsedUrl.pathname.endsWith("/check/")) {
        return Response.json({
          result: {
            "task-extra": {
              status: "success",
              source_id: "source-extra",
              presets: {},
              result: {
                duration: 1,
                tracks: Array.from({ length: 8 }, (_, index) => ({
                  type: "stem",
                  label: `stem-${index + 1}`,
                  url: `https://files.example.test/stem-${index + 1}.wav`
                }))
              }
            }
          }
        });
      }

      return new Response("not found", { status: 404 });
    }
  });
  const provider = new LalalInstrumentStemSeparationProvider(client, artifactStore);

  await assert.rejects(
    () =>
      provider.separateInstruments(input.artifact, {
        jobId: "job-lalal-extra",
        traceId: "trace-job-lalal-extra",
        emit: () => undefined
      }),
    /expected at most 7/
  );
});
