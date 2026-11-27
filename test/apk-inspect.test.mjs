import test from "node:test";
import assert from "node:assert/strict";

import { ApkInspectError, artifactAbiOf, inspectApk } from "../src/apk-inspect.js";
import {
  REAL_ICON_EXPECTED,
  REAL_MANIFEST_EXPECTED,
  buildAdaptiveXml,
  buildManifest,
  buildResourcesTable,
  buildVectorXml,
  buildZip,
  makeApk,
  patchCentralEntry,
  patchEocd,
  realApk,
  realApkWithResources,
  withZip64Locator,
} from "./fixtures.mjs";

function expectCode(code) {
  return (error) => {
    assert.ok(error instanceof ApkInspectError, `expected ApkInspectError, got ${error}`);
    assert.equal(error.code, code, error.message);
    return true;
  };
}

test("reads the shared real AXML fixture wrapped as an arm64 APK", async () => {
  const metadata = await inspectApk(realApk());
  assert.deepEqual(
    {
      packageName: metadata.packageName,
      versionCode: metadata.versionCode,
      versionName: metadata.versionName,
      minSdk: metadata.minSdk,
      targetSdk: metadata.targetSdk,
      artifactAbi: metadata.artifactAbi,
    },
    REAL_MANIFEST_EXPECTED,
  );
  assert.deepEqual(metadata.abis, ["arm64-v8a"]);
  assert.equal(metadata.universal, false);
  assert.equal(metadata.debuggable, false);
  assert.equal(metadata.testOnly, false);
  assert.equal(metadata.configSplit, false);
  assert.equal(metadata.split, null);
});

test("accepts Uint8Array, ArrayBuffer, Buffer and Blob sources", async () => {
  const apk = realApk();
  const fromView = await inspectApk(apk);
  const fromArrayBuffer = await inspectApk(
    apk.buffer.slice(apk.byteOffset, apk.byteOffset + apk.byteLength),
  );
  const fromBuffer = await inspectApk(Buffer.from(apk));
  const fromBlob = await inspectApk(new Blob([apk]));
  assert.equal(fromView.packageName, REAL_MANIFEST_EXPECTED.packageName);
  assert.deepEqual(fromArrayBuffer, fromView);
  assert.deepEqual(fromBuffer, fromView);
  assert.deepEqual(fromBlob, fromView);
});

test("stored and deflated manifests parse identically", async () => {
  const stored = await inspectApk(
    makeApk({ manifest: buildManifest({}), manifestMethod: 0 }),
  );
  const deflated = await inspectApk(
    makeApk({ manifest: buildManifest({}), manifestMethod: 8 }),
  );
  assert.deepEqual(deflated, stored);
  assert.equal(stored.packageName, "com.example.fixture");
});

test("supports data descriptors because sizes come from the central directory", async () => {
  const metadata = await inspectApk(
    makeApk({ manifest: buildManifest({}), manifestDataDescriptor: true }),
  );
  assert.equal(metadata.packageName, "com.example.fixture");
  assert.equal(metadata.versionCode, 7);
});

test("UTF-8 and UTF-16LE string pools parse identically", async () => {
  const utf8 = await inspectApk(
    makeApk({ manifest: buildManifest({ utf8: true, versionName: "Việt Nam" }) }),
  );
  const utf16 = await inspectApk(
    makeApk({ manifest: buildManifest({ utf8: false, versionName: "Việt Nam" }) }),
  );
  assert.equal(utf8.versionName, "Việt Nam");
  assert.deepEqual(utf16, utf8);
});

test("ABI detection follows lib/<abi>/ and defaults to universal", async () => {
  const none = await inspectApk(makeApk({ manifest: buildManifest({}) }));
  assert.deepEqual(none.abis, []);
  assert.equal(none.universal, true);
  assert.equal(none.artifactAbi, "universal");

  const single = await inspectApk(
    makeApk({ manifest: buildManifest({}), abis: ["x86_64"] }),
  );
  assert.deepEqual(single.abis, ["x86_64"]);
  assert.equal(single.universal, false);
  assert.equal(single.artifactAbi, "x86_64");

  const multi = await inspectApk(
    makeApk({
      manifest: buildManifest({}),
      abis: ["x86_64", "arm64-v8a", "armeabi-v7a"],
    }),
  );
  assert.deepEqual(multi.abis, ["arm64-v8a", "armeabi-v7a", "x86_64"]);
  assert.equal(multi.universal, true);
  assert.equal(multi.artifactAbi, "universal");

  const unknown = await inspectApk(
    makeApk({ manifest: buildManifest({}), abis: ["mips"] }),
  );
  assert.deepEqual(unknown.abis, []);
  assert.equal(unknown.artifactAbi, "universal");
});

test("artifactAbiOf mirrors the metadata", () => {
  assert.equal(artifactAbiOf({ abis: ["x86"] }), "x86");
  assert.equal(artifactAbiOf({ abis: ["x86", "x86_64"] }), "universal");
  assert.equal(artifactAbiOf({ abis: [] }), "universal");
  assert.equal(artifactAbiOf(null), "universal");
});

test("reads debuggable, testOnly and resource-reference versionName", async () => {
  const metadata = await inspectApk(
    makeApk({
      manifest: buildManifest({
        versionNameRef: true,
        debuggable: true,
        testOnly: true,
      }),
    }),
  );
  assert.equal(metadata.versionName, null);
  assert.equal(metadata.debuggable, true);
  assert.equal(metadata.testOnly, true);
});

test("treats a codename minSdk as unknown", async () => {
  const metadata = await inspectApk(
    makeApk({ manifest: buildManifest({ minSdkCodename: "S" }) }),
  );
  assert.equal(metadata.minSdk, null);
});

test("treats an empty android:versionName as null", async () => {
  const metadata = await inspectApk(
    makeApk({ manifest: buildManifest({ versionName: "" }) }),
  );
  assert.equal(metadata.versionName, null);
});

test("detects config splits and feature splits", async () => {
  const config = await inspectApk(
    makeApk({ manifest: buildManifest({ split: "config.arm64_v8a" }) }),
  );
  assert.equal(config.split, "config.arm64_v8a");
  assert.equal(config.configSplit, true);

  const feature = await inspectApk(
    makeApk({ manifest: buildManifest({ split: "feature", configForSplit: "base" }) }),
  );
  assert.equal(feature.split, "feature");
  assert.equal(feature.configSplit, true);

  const plain = await inspectApk(
    makeApk({ manifest: buildManifest({ split: "feature" }) }),
  );
  assert.equal(plain.configSplit, false);
});

test("ignores a ZIP comment while locating the EOCD", async () => {
  const manifest = buildManifest({});
  const apk = buildZip(
    [{ name: "AndroidManifest.xml", data: manifest, method: 8 }],
    { comment: "built by the dashboard test suite" },
  );
  const metadata = await inspectApk(apk);
  assert.equal(metadata.packageName, "com.example.fixture");
});

test("rejects garbage and truncated files", async () => {
  await assert.rejects(
    inspectApk(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
    expectCode("invalid_apk"),
  );
  const apk = realApk();
  await assert.rejects(
    inspectApk(apk.subarray(0, apk.length - 12)),
    expectCode("invalid_apk"),
  );
});

test("rejects ZIP64 sentinels and locators", async () => {
  const apk = makeApk({ manifest: buildManifest({}) });
  await assert.rejects(
    inspectApk(patchEocd(apk, { entries: 0xffff })),
    expectCode("zip64"),
  );
  await assert.rejects(inspectApk(withZip64Locator(apk)), expectCode("zip64"));
  await assert.rejects(
    inspectApk(patchCentralEntry(apk, "AndroidManifest.xml", { localOffset: 0xffffffff })),
    expectCode("zip64"),
  );
});

test("enforces the manifest and central-directory caps", async () => {
  const apk = makeApk({ manifest: buildManifest({}) });
  await assert.rejects(
    inspectApk(
      patchCentralEntry(apk, "AndroidManifest.xml", {
        compressedSize: 16 * 1024 * 1024 + 1,
      }),
    ),
    expectCode("invalid_apk"),
  );
  await assert.rejects(
    inspectApk(
      patchCentralEntry(apk, "AndroidManifest.xml", {
        uncompressedSize: 8 * 1024 * 1024 + 1,
      }),
    ),
    expectCode("invalid_apk"),
  );
  await assert.rejects(
    inspectApk(patchEocd(apk, { directorySize: 64 * 1024 * 1024 + 1 })),
    expectCode("invalid_apk"),
  );
});

test("rejects unsupported compression and corrupt manifests", async () => {
  const apk = makeApk({ manifest: buildManifest({}) });
  await assert.rejects(
    inspectApk(patchCentralEntry(apk, "AndroidManifest.xml", { method: 99 })),
    expectCode("invalid_apk"),
  );
  await assert.rejects(
    inspectApk(makeApk({ manifest: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) })),
    expectCode("invalid_apk"),
  );
});

test("rejects an APK without AndroidManifest.xml", async () => {
  const apk = buildZip([{ name: "classes.dex", data: "dex", method: 0 }]);
  await assert.rejects(inspectApk(apk), expectCode("invalid_apk"));
});

test("reports preview_unavailable when DecompressionStream is absent", async () => {
  const original = globalThis.DecompressionStream;
  try {
    globalThis.DecompressionStream = undefined;
    await assert.rejects(
      inspectApk(makeApk({ manifest: buildManifest({}), manifestMethod: 8 })),
      expectCode("preview_unavailable"),
    );
    // A stored manifest still works without the platform inflater.
    const stored = await inspectApk(
      makeApk({ manifest: buildManifest({}), manifestMethod: 0 }),
    );
    assert.equal(stored.packageName, "com.example.fixture");
  } finally {
    globalThis.DecompressionStream = original;
  }
});


/* ---------------------------------------------------- resources.arsc / icon */

test("resolves the real label and adaptive icon descriptor", async () => {
  const metadata = await inspectApk(realApkWithResources());
  assert.equal(metadata.label, REAL_ICON_EXPECTED.label);
  assert.equal(metadata.versionNameSource, "literal");
  assert.deepEqual(metadata.icon, {
    kind: "adaptive",
    entry: REAL_ICON_EXPECTED.adaptiveEntry,
    resourceId: REAL_ICON_EXPECTED.adaptiveResourceId,
  });
});

test("resolves a resource-backed versionName", async () => {
  const table = buildResourcesTable({
    types: [
      {
        name: "string",
        id: 14,
        entries: [
          {
            key: "version_name",
            configs: [{ config: {}, value: { type: "string", value: "2.4.0" } }],
          },
        ],
      },
    ],
  });
  const apk = makeApk({
    manifest: buildManifest({
      packageName: "com.example.ref",
      versionCode: 9,
      versionNameRef: true,
      versionNameRefId: 0x7f0e0000,
    }),
    extras: [{ name: "resources.arsc", data: table, method: 0 }],
  });
  const metadata = await inspectApk(apk);
  assert.equal(metadata.versionName, "2.4.0");
  assert.equal(metadata.versionNameSource, "resource");
});

test("classifies a synthesized adaptive icon and its nested resources", async () => {
  const table = buildResourcesTable({
    types: [
      {
        name: "color",
        id: 4,
        entries: [
          {
            key: "bg",
            configs: [{ config: {}, value: { type: "color", value: 0xffff4f40 } }],
          },
        ],
      },
      {
        name: "drawable",
        id: 6,
        entries: [
          {
            key: "fg",
            configs: [{ config: {}, value: { type: "string", value: "res/vector.xml" } }],
          },
        ],
      },
      {
        name: "mipmap",
        id: 11,
        entries: [
          {
            key: "ic_launcher",
            configs: [
              { config: { density: 0xfffe }, value: { type: "string", value: "res/adaptive.xml" } },
            ],
          },
        ],
      },
    ],
  });
  const apk = makeApk({
    manifest: buildManifest({
      packageName: "com.example.icon",
      iconRef: 0x7f0b0000,
      labelRef: null,
    }),
    extras: [
      { name: "resources.arsc", data: table, method: 0 },
      {
        name: "res/adaptive.xml",
        data: buildAdaptiveXml({
          background: { ref: 0x7f040000 },
          foreground: { ref: 0x7f060000 },
        }),
        method: 0,
      },
      {
        name: "res/vector.xml",
        data: buildVectorXml({
          paths: [{ pathData: "M0,0h10v10z", fillColor: 0xffffffff }],
        }),
        method: 0,
      },
    ],
  });
  const metadata = await inspectApk(apk);
  assert.deepEqual(metadata.icon, {
    kind: "adaptive",
    entry: "res/adaptive.xml",
    resourceId: 0x7f0b0000,
  });
});

test("picks the highest-density raster icon when no XML exists", async () => {
  const table = buildResourcesTable({
    types: [
      {
        name: "mipmap",
        id: 11,
        entries: [
          {
            key: "ic_launcher",
            configs: [
              { config: { density: 160 }, value: { type: "string", value: "res/mdpi.png" } },
              { config: { density: 640 }, value: { type: "string", value: "res/xxxhdpi.png" } },
            ],
          },
        ],
      },
    ],
  });
  const apk = makeApk({
    manifest: buildManifest({ packageName: "com.example.raster", iconRef: 0x7f0b0000 }),
    extras: [
      { name: "resources.arsc", data: table, method: 0 },
      { name: "res/mdpi.png", data: new Uint8Array([1]), method: 0 },
      { name: "res/xxxhdpi.png", data: new Uint8Array([2]), method: 0 },
    ],
  });
  const metadata = await inspectApk(apk);
  assert.equal(metadata.icon.kind, "raster");
  assert.equal(metadata.icon.entry, "res/xxxhdpi.png");
  assert.equal(metadata.icon.contentType, "image/png");
  assert.equal(metadata.icon.density, 640);
});

test("a corrupt resources.arsc degrades to no label/icon without failing", async () => {
  const apk = makeApk({
    manifest: buildManifest({ packageName: "com.example.broken", iconRef: 0x7f0b0000 }),
    extras: [{ name: "resources.arsc", data: new Uint8Array([1, 2, 3, 4]), method: 0 }],
  });
  const metadata = await inspectApk(apk);
  assert.equal(metadata.packageName, "com.example.broken");
  assert.equal(metadata.label, null);
  assert.equal(metadata.icon, null);
});

test("versionNameSource is none when the manifest has no versionName", async () => {
  const metadata = await inspectApk(
    makeApk({ manifest: buildManifest({ versionName: null, versionNameRef: false }) }),
  );
  assert.equal(metadata.versionName, null);
  assert.equal(metadata.versionNameSource, "none");
});
