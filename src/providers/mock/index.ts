import type { PipelineProviders } from "../../pipeline/types.ts";
import { MockDereverbProvider } from "./dereverbProvider.ts";
import { MockInstrumentIdentificationProvider } from "./instrumentIdentificationProvider.ts";
import { MockInstrumentStemSeparationProvider } from "./stemSeparationProvider.ts";
import { MockMidiConversionProvider } from "./midiConversionProvider.ts";
import { MockOpenDawProvider } from "./opendawProvider.ts";

export function createMockProviders(): PipelineProviders {
  return {
    dereverb: new MockDereverbProvider(),
    instrumentStemSeparation: new MockInstrumentStemSeparationProvider(),
    instrumentIdentification: new MockInstrumentIdentificationProvider(),
    midiConversion: new MockMidiConversionProvider(),
    opendaw: new MockOpenDawProvider()
  };
}
