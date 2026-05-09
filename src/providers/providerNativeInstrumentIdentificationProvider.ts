import type { InstrumentIdentificationProvider, InstrumentStem } from "../pipeline/types.ts";
import { inferInstrumentLabelFromName } from "../pipeline/naming.ts";

export class ProviderNativeInstrumentIdentificationProvider implements InstrumentIdentificationProvider {
  async identifyInstruments(stems: InstrumentStem[]): Promise<InstrumentStem[]> {
    return stems.map((item) => ({
      ...item,
      label: item.label ?? inferInstrumentLabelFromName(item.stem.filename, item.stem.id)
    }));
  }
}
