import test from "node:test";
import assert from "node:assert/strict";

import { normalizeApp } from "../src/model.js";

const api = { iconUrl: () => "" };

test("normalizeApp preserves packageBound true/false/undefined", () => {
  const base = { id: "com.example.raster", name: "Raster", packageName: "com.example.raster" };
  assert.equal(normalizeApp({ ...base, packageBound: true }, null, api, 1).packageBound, true);
  assert.equal(normalizeApp({ ...base, packageBound: false }, null, api, 1).packageBound, false);
  assert.equal(normalizeApp(base, null, api, 1).packageBound, undefined);
});
