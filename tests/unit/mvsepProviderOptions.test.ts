import assert from "node:assert/strict";
import test from "node:test";
import {
  MVSEP_DEREVERB_MODEL_TYPE,
  MVSEP_DEREVERB_PREPROCESS_MODE,
  MVSEP_DEREVERB_SEP_TYPE
} from "../../src/providers/mvsep/providers.ts";

test("MVSEP de-reverb options select FoxJoy MDX23C reverb removal", () => {
  assert.equal(MVSEP_DEREVERB_SEP_TYPE, 22);
  assert.equal(MVSEP_DEREVERB_MODEL_TYPE, "0");
  assert.equal(MVSEP_DEREVERB_PREPROCESS_MODE, "1");
});
