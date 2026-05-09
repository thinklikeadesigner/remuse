import type { InstrumentIdentificationProvider, InstrumentStem } from "../pipeline/types.ts";
import { inferInstrumentLabel } from "../pipeline/naming.ts";

function metadataString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export class ProviderNativeInstrumentIdentificationProvider implements InstrumentIdentificationProvider {
  async identifyInstruments(stems: InstrumentStem[]): Promise<InstrumentStem[]> {
    return stems.map((item) => ({
      ...item,
      label:
        item.label ??
        inferInstrumentLabel({
          providerLabel: metadataString(item.stem.metadata.providerLabel),
          filename: item.stem.filename,
          detectedFromArtifactId: item.stem.id
        })
    }));
  }
}
