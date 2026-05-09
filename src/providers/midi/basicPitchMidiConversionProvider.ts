import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeMidiFilename } from "../../pipeline/naming.ts";
import type { InstrumentLabel, InstrumentStem, MidiArtifact, MidiConversionProvider, MidiConversionResult, ProviderContext } from "../../pipeline/types.ts";
import type { FileArtifactStore } from "../../storage/fileArtifactStore.ts";

export type BasicPitchModelSerialization = "tf" | "coreml" | "tflite" | "onnx";

export type BasicPitchCommandResult = {
  stdout: string;
  stderr: string;
};

export type BasicPitchCommandRunnerOptions = {
  env?: NodeJS.ProcessEnv;
};

export type BasicPitchCommandRunner = (command: string, args: string[], options?: BasicPitchCommandRunnerOptions) => Promise<BasicPitchCommandResult>;

export type BasicPitchMidiConversionProviderOptions = {
  artifactStore: FileArtifactStore;
  command?: string;
  modelSerialization?: BasicPitchModelSerialization;
  runner?: BasicPitchCommandRunner;
};

const defaultCommand = "basic-pitch";
const providerName = "basic-pitch";

function nowIso(): string {
  return new Date().toISOString();
}

function commandOutput(stdout: string, stderr: string): string {
  const text = [stdout.trim(), stderr.trim()].filter((item) => item.length > 0).join("\n");
  return text.length > 0 ? `\n${text.slice(0, 2000)}` : "";
}

export const defaultBasicPitchCommandRunner: BasicPitchCommandRunner = (command, args, options) => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        ...(options?.env ?? {})
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error(`Basic Pitch command "${command}" was not found. Install it with "pip install basic-pitch" or set BASIC_PITCH_COMMAND.`));
        return;
      }

      reject(error);
    });
    child.on("close", (code) => {
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (code === 0) {
        resolve({ stdout: stdoutText, stderr: stderrText });
        return;
      }

      reject(new Error(`Basic Pitch command "${command}" failed with exit code ${code}.${commandOutput(stdoutText, stderrText)}`));
    });
  });
};

function localArtifactPath(stem: InstrumentStem & { label: InstrumentLabel }): string {
  const url = new URL(stem.stem.uri);
  if (url.protocol !== "file:") {
    throw new Error(`Basic Pitch requires local file artifacts, but stem ${stem.stem.id} uses ${stem.stem.uri}.`);
  }

  return fileURLToPath(url);
}

async function listMidiFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isFile() && /\.(?:mid|midi)$/i.test(entry.name)) {
      files.push(absolutePath);
    }
  }

  return files.sort();
}

function basicPitchWarning(label: InstrumentLabel): string | undefined {
  if (label.family === "drums" || label.family === "percussion") {
    return "Basic Pitch is optimized for tonal pitched material; drum/percussion MIDI may be approximate.";
  }

  return undefined;
}

export class BasicPitchMidiConversionProvider implements MidiConversionProvider {
  private readonly artifactStore: FileArtifactStore;
  private readonly command: string;
  private readonly modelSerialization: BasicPitchModelSerialization | undefined;
  private readonly runner: BasicPitchCommandRunner;

  constructor(options: BasicPitchMidiConversionProviderOptions) {
    this.artifactStore = options.artifactStore;
    this.command = options.command ?? defaultCommand;
    this.modelSerialization = options.modelSerialization;
    this.runner = options.runner ?? defaultBasicPitchCommandRunner;
  }

  async convertStemsToMidi(stems: Array<InstrumentStem & { label: InstrumentLabel }>, context: ProviderContext): Promise<MidiConversionResult> {
    const midiFiles: MidiArtifact[] = [];
    const workRoot = join(this.artifactStore.rootDir, context.jobId, "basic-pitch-work");
    const runtimeRoot = join(this.artifactStore.rootDir, context.jobId, "basic-pitch-runtime");
    const tempDirectory = join(runtimeRoot, "tmp");
    const numbaCacheDirectory = join(runtimeRoot, "numba-cache");
    await mkdir(workRoot, { recursive: true });
    await mkdir(tempDirectory, { recursive: true });
    await mkdir(numbaCacheDirectory, { recursive: true });

    for (const [index, stem] of stems.entries()) {
      const filename = makeMidiFilename(context.jobId, stem.label, index);
      const outputDirectory = await mkdtemp(join(workRoot, `stem-${String(index + 1).padStart(2, "0")}-`));
      const inputPath = localArtifactPath(stem);
      const args = this.commandArgs(outputDirectory, inputPath);
      await context.emit({
        step: "midi-conversion",
        status: "running",
        message: `Running Basic Pitch for ${stem.stem.filename}.`,
        at: nowIso()
      });
      await this.runner(this.command, args, {
        env: {
          TMPDIR: tempDirectory,
          NUMBA_CACHE_DIR: numbaCacheDirectory
        }
      });

      const generatedMidiFiles = await listMidiFiles(outputDirectory);
      if (generatedMidiFiles.length === 0) {
        throw new Error(`Basic Pitch did not create a MIDI file for ${stem.stem.filename}.`);
      }

      const generatedMidiPath = generatedMidiFiles.find((item) => /basic[_-]pitch/i.test(item)) ?? generatedMidiFiles[0];
      if (generatedMidiPath === undefined) {
        throw new Error(`Basic Pitch did not create a readable MIDI file for ${stem.stem.filename}.`);
      }

      const warning = basicPitchWarning(stem.label);
      if (warning !== undefined) {
        await context.emit({
          step: "midi-conversion",
          status: "running",
          message: warning,
          at: nowIso()
        });
      }

      const saved = await this.artifactStore.saveMidiArtifact({
        jobId: context.jobId,
        stage: "midi",
        filename,
        bytes: await readFile(generatedMidiPath),
        sourceArtifactIds: [stem.stem.id],
        instrument: stem.label,
        metadata: {
          provider: providerName,
          providerCommand: this.command,
          providerOutputFilename: generatedMidiPath.split(/[\\/]/).pop() ?? generatedMidiPath,
          sourceStem: stem.stem.filename,
          stemIndex: index,
          basicPitchDownmixesToMono: true,
          basicPitchModelSampleRateHz: 22050,
          basicPitchPitchBends: true,
          ...(this.modelSerialization === undefined ? {} : { modelSerialization: this.modelSerialization }),
          ...(warning === undefined ? {} : { providerWarning: warning })
        }
      });
      midiFiles.push(saved.artifact);
    }

    return { midiFiles };
  }

  private commandArgs(outputDirectory: string, inputPath: string): string[] {
    return [
      "--save-midi",
      ...(this.modelSerialization === undefined ? [] : ["--model-serialization", this.modelSerialization]),
      outputDirectory,
      inputPath
    ];
  }
}
