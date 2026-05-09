import { basename } from "node:path";
import type { InstrumentFamily, InstrumentLabel } from "../../pipeline/types.ts";
import { normalizeInstrumentName } from "../../pipeline/naming.ts";

export type MvsepFileRef = {
  url: string;
  filename: string;
  label: string;
  raw: unknown;
};

const stemOrder = ["vocals", "drums", "bass", "guitar", "piano", "keys", "strings", "wind", "synth", "other"];

const labelMap: Array<{
  hints: string[];
  canonicalName: string;
  family: InstrumentFamily;
  confidence: number;
  midiProgram?: number;
  sampleLibraryKey?: string;
}> = [
  { hints: ["vocal", "vocals", "voice", "vox"], canonicalName: "vocal", family: "vocal", confidence: 0.86, sampleLibraryKey: "vocal-synth" },
  { hints: ["drum", "drums", "kick", "snare"], canonicalName: "drums", family: "drums", confidence: 0.88, sampleLibraryKey: "studio-drums" },
  { hints: ["bass"], canonicalName: "electric-bass", family: "bass", confidence: 0.88, midiProgram: 33, sampleLibraryKey: "electric-bass" },
  { hints: ["electric-guitar", "acoustic-guitar", "guitar"], canonicalName: "clean-guitar", family: "guitar", confidence: 0.84, midiProgram: 29, sampleLibraryKey: "clean-electric-guitar" },
  { hints: ["piano"], canonicalName: "piano", family: "keys", confidence: 0.88, midiProgram: 1, sampleLibraryKey: "grand-piano" },
  { hints: ["keys", "keyboard", "organ"], canonicalName: "keys", family: "keys", confidence: 0.78, midiProgram: 5, sampleLibraryKey: "grand-piano" },
  { hints: ["string", "strings", "violin", "cello"], canonicalName: "strings", family: "strings", confidence: 0.78, midiProgram: 49, sampleLibraryKey: "studio-strings" },
  { hints: ["wind", "winds", "brass", "woodwind"], canonicalName: "woodwinds", family: "woodwinds", confidence: 0.74, midiProgram: 74, sampleLibraryKey: "studio-woodwinds" },
  { hints: ["synth", "synthesizer"], canonicalName: "synth", family: "synth", confidence: 0.78, midiProgram: 81, sampleLibraryKey: "analog-synth" },
  { hints: ["other"], canonicalName: "other", family: "unknown", confidence: 0.45 }
];

function stringValue(input: unknown): string | undefined {
  return typeof input === "string" && input.trim().length > 0 ? input : undefined;
}

function objectValue(input: unknown): Record<string, unknown> | undefined {
  return input !== null && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : undefined;
}

function urlFromObject(input: Record<string, unknown>): string | undefined {
  return (
    stringValue(input.url) ??
    stringValue(input.download_url) ??
    stringValue(input.downloadUrl) ??
    stringValue(input.link) ??
    stringValue(input.download) ??
    stringValue(input.path)
  );
}

function filenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return basename(decodeURIComponent(parsed.pathname)) || "mvsep-output.wav";
  } catch {
    return basename(url) || "mvsep-output.wav";
  }
}

function normalizeUrl(url: string, baseUrl: string): string {
  try {
    return new URL(url, baseUrl).href;
  } catch {
    return url;
  }
}

function filenameFromObject(input: Record<string, unknown>, fallbackUrl: string, fallbackKey?: string): string {
  return (
    stringValue(input.filename) ??
    stringValue(input.file_name) ??
    stringValue(input.name) ??
    stringValue(input.title) ??
    fallbackKey ??
    filenameFromUrl(fallbackUrl)
  );
}

function labelFromObject(input: Record<string, unknown>, filename: string, fallbackKey?: string): string {
  return (
    stringValue(input.label) ??
    stringValue(input.stem) ??
    stringValue(input.type) ??
    fallbackKey ??
    filename.replace(/\.[a-z0-9]+$/i, "")
  );
}

function fileFromEntry(value: unknown, baseUrl: string, fallbackKey?: string): MvsepFileRef | undefined {
  const directUrl = stringValue(value);
  if (directUrl !== undefined) {
    const url = normalizeUrl(directUrl, baseUrl);
    const filename = fallbackKey ?? filenameFromUrl(url);
    return {
      url,
      filename,
      label: filename.replace(/\.[a-z0-9]+$/i, ""),
      raw: value
    };
  }

  const object = objectValue(value);
  if (object === undefined) {
    return undefined;
  }

  const objectUrl = urlFromObject(object);
  if (objectUrl === undefined) {
    return undefined;
  }

  const url = normalizeUrl(objectUrl, baseUrl);
  const filename = filenameFromObject(object, url, fallbackKey);
  return {
    url,
    filename,
    label: labelFromObject(object, filename, fallbackKey),
    raw: value
  };
}

export function extractMvsepFiles(response: unknown, baseUrl = "https://mvsep.com"): MvsepFileRef[] {
  const root = objectValue(response);
  const data = objectValue(root?.data) ?? root;
  const files = data?.files;

  if (Array.isArray(files)) {
    return files.flatMap((file) => {
      const normalized = fileFromEntry(file, baseUrl);
      return normalized === undefined ? [] : [normalized];
    });
  }

  const fileObject = objectValue(files);
  if (fileObject !== undefined) {
    return Object.entries(fileObject).flatMap(([key, value]) => {
      const normalized = fileFromEntry(value, baseUrl, key);
      return normalized === undefined ? [] : [normalized];
    });
  }

  return [];
}

function normalizedSearchText(input: string): string {
  return normalizeInstrumentName(input).replace(/-/g, " ");
}

export function normalizeMvsepStemLabel(input: {
  providerLabel?: string;
  filename: string;
  detectedFromArtifactId: string;
}): InstrumentLabel {
  const searchText = normalizedSearchText(`${input.providerLabel ?? ""} ${input.filename}`);
  const match = labelMap.find((candidate) => candidate.hints.some((hint) => searchText.includes(hint.replace(/-/g, " "))));
  const canonicalName = match?.canonicalName ?? normalizeInstrumentName(input.providerLabel ?? input.filename);

  return {
    canonicalName,
    family: match?.family ?? "unknown",
    confidence: match?.confidence ?? 0.4,
    detectedFromArtifactId: input.detectedFromArtifactId,
    method: "provider-native",
    ...(match?.midiProgram === undefined ? {} : { midiProgram: match.midiProgram }),
    ...(match?.sampleLibraryKey === undefined ? {} : { sampleLibraryKey: match.sampleLibraryKey })
  };
}

function dryScore(file: MvsepFileRef): number {
  const text = normalizedSearchText(`${file.label} ${file.filename}`);
  let score = 0;
  if (text.includes("no reverb") || text.includes("noreverb")) score += 5;
  if (text.includes("dereverb") || text.includes("de reverb")) score += 4;
  if (text.includes("dry")) score += 3;
  if (text.includes("stem")) score += 1;
  return score;
}

function reverbScore(file: MvsepFileRef): number {
  const text = normalizedSearchText(`${file.label} ${file.filename}`);
  if (text.includes("no reverb") || text.includes("noreverb") || text.includes("dereverb") || text.includes("de reverb")) {
    return 0;
  }

  let score = 0;
  if (text.includes("reverb")) score += 5;
  if (text.includes("echo")) score += 3;
  if (text.includes("wet")) score += 3;
  return score;
}

export function selectDereverbFiles(files: MvsepFileRef[]): {
  dryOnly?: MvsepFileRef;
  reverbOnly?: MvsepFileRef;
} {
  const dryOnly = [...files].sort((left, right) => dryScore(right) - dryScore(left))[0];
  const reverbOnly = [...files].sort((left, right) => reverbScore(right) - reverbScore(left))[0];

  return {
    ...(dryOnly !== undefined && dryScore(dryOnly) > 0 ? { dryOnly } : {}),
    ...(reverbOnly !== undefined && reverbScore(reverbOnly) > 0 ? { reverbOnly } : {})
  };
}

export function sortMvsepStemFiles(files: MvsepFileRef[]): MvsepFileRef[] {
  return [...files].sort((left, right) => {
    const leftText = normalizedSearchText(`${left.label} ${left.filename}`);
    const rightText = normalizedSearchText(`${right.label} ${right.filename}`);
    const leftIndex = stemOrder.findIndex((stem) => leftText.includes(stem));
    const rightIndex = stemOrder.findIndex((stem) => rightText.includes(stem));
    const safeLeftIndex = leftIndex === -1 ? stemOrder.length : leftIndex;
    const safeRightIndex = rightIndex === -1 ? stemOrder.length : rightIndex;
    return safeLeftIndex - safeRightIndex || left.filename.localeCompare(right.filename);
  });
}
