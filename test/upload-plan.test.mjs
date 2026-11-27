import test from "node:test";
import assert from "node:assert/strict";

import {
  applyInspection,
  applyInspectionError,
  applyPrefill,
  computeAllowMismatch,
  isFieldTouched,
  matchAppByPackage,
  refreshUploadValidation,
  selectAppForPackage,
  validateUploadFiles,
} from "../src/upload-plan.js";

function metadata(overrides = {}) {
  return {
    packageName: "com.example.app",
    versionCode: 7,
    versionName: "1.2.3",
    minSdk: 26,
    targetSdk: 35,
    abis: ["arm64-v8a"],
    universal: false,
    debuggable: false,
    testOnly: false,
    split: null,
    configSplit: false,
    artifactAbi: "arm64-v8a",
    ...overrides,
  };
}

function file(id, overrides = {}) {
  return {
    id,
    name: `${id}.apk`,
    sizeBytes: 1024,
    abi: "arm64-v8a",
    detectedAbi: null,
    abiOverridden: false,
    status: "inspecting",
    metadata: null,
    error: "",
    previewUnavailable: false,
    previewMessage: "",
    progress: 0,
    sha256: null,
    ...overrides,
  };
}

function readyFile(id, overrides = {}) {
  const meta = overrides.metadata || metadata();
  return file(id, {
    status: "ready",
    metadata: meta,
    detectedAbi: meta.artifactAbi,
    abi: meta.artifactAbi,
    ...overrides,
  });
}

function makeUpload(overrides = {}) {
  return {
    appId: "app",
    existingVersion: false,
    versionName: "1.2.3",
    versionCode: "7",
    minSdk: "26",
    touched: { versionName: false, versionCode: false, minSdk: false },
    files: [],
    explicitApp: false,
    appTouched: false,
    consistency: { fatal: [], warnings: [], inspecting: false },
    ...overrides,
  };
}

function codes(items) {
  return items.map((item) => item.code);
}

/* ------------------------------------------------------------- inspection */

test("applyInspection stores metadata and lets it win over the filename guess", () => {
  const upload = makeUpload({ files: [file("a", { abi: "arm64-v8a" })] });
  const stored = applyInspection(upload, "a", metadata({ artifactAbi: "x86_64" }));
  assert.equal(stored.status, "ready");
  assert.equal(stored.abi, "x86_64");
  assert.equal(stored.detectedAbi, "x86_64");
  assert.deepEqual(stored.metadata.abis, ["arm64-v8a"]);
});

test("applyInspection preserves an explicit ABI override", () => {
  const upload = makeUpload({
    files: [file("a", { abi: "x86_64", abiOverridden: true })],
  });
  const stored = applyInspection(upload, "a", metadata());
  assert.equal(stored.abi, "x86_64");
  assert.equal(stored.detectedAbi, "arm64-v8a");
});

test("applyInspectionError blocks invalid APKs but allows preview_unavailable", () => {
  const upload = makeUpload({ files: [file("bad"), file("old")] });
  const bad = applyInspectionError(upload, "bad", {
    code: "invalid_apk",
    message: "AndroidManifest.xml hỏng",
  });
  assert.equal(bad.status, "error");
  assert.equal(bad.errorCode, "invalid_apk");
  assert.match(bad.error, /hỏng/);

  const old = applyInspectionError(upload, "old", {
    code: "preview_unavailable",
    message: "Trình duyệt cũ",
  });
  assert.equal(old.status, "ready");
  assert.equal(old.previewUnavailable, true);
  assert.equal(old.metadata, null);
  assert.equal(old.error, "");
  assert.match(old.previewMessage, /Trình duyệt cũ/);
});

/* ----------------------------------------------------------------- prefill */

test("applyPrefill fills untouched fields from the inspected APK", () => {
  const upload = makeUpload({
    versionName: "9.9.9",
    versionCode: "99",
    minSdk: "21",
    files: [readyFile("a")],
  });
  const applied = applyPrefill(upload);
  assert.deepEqual(applied, {
    versionName: true,
    versionCode: true,
    minSdk: true,
  });
  assert.equal(upload.versionName, "1.2.3");
  assert.equal(upload.versionCode, "7");
  assert.equal(upload.minSdk, "26");
});

test("applyPrefill never overwrites a field the user touched", () => {
  const upload = makeUpload({
    versionName: "9.9.9",
    versionCode: "99",
    minSdk: "21",
    touched: { versionName: false, versionCode: true, minSdk: false },
    files: [readyFile("a")],
  });
  const applied = applyPrefill(upload);
  assert.equal(applied.versionCode, false);
  assert.equal(upload.versionCode, "99");
  assert.equal(upload.versionName, "1.2.3");
  assert.equal(upload.minSdk, "26");
});

test("applyPrefill accepts a Set of touched fields", () => {
  const upload = makeUpload({
    versionName: "9.9.9",
    files: [readyFile("a")],
  });
  applyPrefill(upload, new Set(["versionName"]));
  assert.equal(upload.versionName, "9.9.9");
  assert.equal(upload.versionCode, "7");
});

test("applyPrefill does nothing for an existing version modal", () => {
  const upload = makeUpload({
    existingVersion: true,
    versionName: "0.2.0",
    versionCode: "18",
    minSdk: "26",
    files: [readyFile("a")],
  });
  const applied = applyPrefill(upload);
  assert.deepEqual(applied, {
    versionName: false,
    versionCode: false,
    minSdk: false,
  });
  assert.equal(upload.versionName, "0.2.0");
  assert.equal(upload.versionCode, "18");
});

test("applyPrefill leaves null manifest values alone", () => {
  const upload = makeUpload({
    versionName: "9.9.9",
    minSdk: "21",
    files: [
      readyFile("a", {
        metadata: metadata({ versionName: null, minSdk: null }),
      }),
    ],
  });
  const applied = applyPrefill(upload);
  assert.equal(applied.versionName, false);
  assert.equal(applied.minSdk, false);
  assert.equal(upload.versionName, "9.9.9");
  assert.equal(upload.minSdk, "21");
});

test("isFieldTouched understands objects and Sets", () => {
  assert.equal(isFieldTouched(undefined, "versionCode"), false);
  assert.equal(isFieldTouched({ versionCode: true }, "versionCode"), true);
  assert.equal(isFieldTouched({ versionCode: false }, "versionCode"), false);
  assert.equal(isFieldTouched(new Set(["sdk"]), "sdk"), true);
  assert.equal(isFieldTouched(new Set(["sdk"]), "versionCode"), false);
});

/* ---------------------------------------------------------- allow_mismatch */

test("computeAllowMismatch stays empty when the form matches the APK", () => {
  const upload = makeUpload({ files: [readyFile("a")] });
  assert.deepEqual(computeAllowMismatch(upload), []);
});

test("computeAllowMismatch adds version when a touched field differs", () => {
  const upload = makeUpload({
    versionCode: "8",
    touched: { versionName: false, versionCode: true, minSdk: false },
    files: [readyFile("a")],
  });
  assert.deepEqual(computeAllowMismatch(upload), ["version"]);

  const same = makeUpload({
    versionCode: "7",
    touched: { versionName: false, versionCode: true, minSdk: false },
    files: [readyFile("a")],
  });
  assert.deepEqual(computeAllowMismatch(same), []);
});

test("computeAllowMismatch adds sdk and abi when edited", () => {
  const upload = makeUpload({
    minSdk: "24",
    touched: { versionName: false, versionCode: false, minSdk: true },
    files: [readyFile("a", { abi: "x86_64", abiOverridden: true })],
  });
  assert.deepEqual(computeAllowMismatch(upload), ["sdk", "abi"]);
});

test("computeAllowMismatch uses the canonical CSV order", () => {
  const upload = makeUpload({
    versionName: "9.9.9",
    versionCode: "8",
    minSdk: "24",
    touched: { versionName: true, versionCode: true, minSdk: true },
    files: [readyFile("a", { abi: "universal", abiOverridden: true })],
  });
  assert.deepEqual(computeAllowMismatch(upload), ["version", "sdk", "abi"]);
});

test("computeAllowMismatch covers an explicit ABI when preview is unavailable", () => {
  const upload = makeUpload({
    files: [
      file("a", {
        status: "ready",
        metadata: null,
        previewUnavailable: true,
        previewMessage: "Trình duyệt cũ",
        abi: "x86_64",
        abiOverridden: true,
      }),
    ],
  });
  assert.deepEqual(computeAllowMismatch(upload), ["abi"]);
  assert.deepEqual(codes(validateUploadFiles(upload, null).warnings), [
    "preview_unavailable",
    "abi_override",
  ]);
});

/* ------------------------------------------------------------- validation */

test("validateUploadFiles reports inspecting files without blocking on them", () => {
  const result = validateUploadFiles(makeUpload({ files: [file("a")] }), null);
  assert.equal(result.inspecting, true);
  assert.equal(result.fatal.length, 0);
});

test("validateUploadFiles blocks invalid APKs and config splits", () => {
  const upload = makeUpload({
    files: [
      file("bad", { status: "error", error: "không đọc được" }),
      readyFile("split", {
        metadata: metadata({ split: "config.arm64_v8a", configSplit: true }),
      }),
    ],
  });
  const result = validateUploadFiles(upload, null);
  assert.deepEqual(codes(result.fatal), ["inspect_error", "config_split"]);
});

test("validateUploadFiles rejects duplicate ABIs without dropping a file", () => {
  const upload = makeUpload({
    files: [readyFile("a"), readyFile("b")],
  });
  const result = validateUploadFiles(upload, null);
  assert.deepEqual(codes(result.fatal), ["duplicate_abi"]);
  assert.equal(upload.files.length, 2);
});

test("validateUploadFiles catches package and version disagreement between files", () => {
  const packages = makeUpload({
    files: [
      readyFile("a"),
      readyFile("b", {
        abi: "x86_64",
        metadata: metadata({ packageName: "com.other.app", artifactAbi: "x86_64" }),
      }),
    ],
  });
  assert.ok(codes(validateUploadFiles(packages, null).fatal).includes("package_mismatch"));

  const codesMismatch = makeUpload({
    files: [
      readyFile("a"),
      readyFile("b", {
        abi: "x86_64",
        metadata: metadata({ versionCode: 8, artifactAbi: "x86_64" }),
      }),
    ],
  });
  assert.ok(codes(validateUploadFiles(codesMismatch, null).fatal).includes("version_mismatch"));

  const namesMismatch = makeUpload({
    files: [
      readyFile("a"),
      readyFile("b", {
        abi: "x86_64",
        metadata: metadata({ versionName: "2.0.0", artifactAbi: "x86_64" }),
      }),
    ],
  });
  assert.ok(codes(validateUploadFiles(namesMismatch, null).fatal).includes("version_mismatch"));
});

test("validateUploadFiles ignores null versionName when comparing files", () => {
  const upload = makeUpload({
    files: [
      readyFile("a"),
      readyFile("b", {
        abi: "x86_64",
        metadata: metadata({ versionName: null, artifactAbi: "x86_64" }),
      }),
    ],
  });
  const result = validateUploadFiles(upload, null);
  assert.equal(result.fatal.length, 0);
});

test("validateUploadFiles warns about debuggable, testOnly and an ABI override", () => {
  const upload = makeUpload({
    files: [
      readyFile("a", {
        abi: "x86_64",
        abiOverridden: true,
        metadata: metadata({ debuggable: true, testOnly: true }),
      }),
    ],
  });
  const result = validateUploadFiles(upload, null);
  assert.deepEqual(codes(result.warnings), ["debuggable", "testOnly", "abi_override"]);
});

test("validateUploadFiles warns when the APK package differs from the app", () => {
  const app = { id: "crm", packageName: "com.acme.crm" };
  const mismatch = validateUploadFiles(makeUpload({ files: [readyFile("a")] }), app);
  assert.ok(codes(mismatch.warnings).includes("app_package_mismatch"));

  const placeholder = { id: "com.example.app", packageName: "com.example.app" };
  const silent = validateUploadFiles(makeUpload({ files: [readyFile("a")] }), placeholder);
  assert.ok(!codes(silent.warnings).includes("app_package_mismatch"));

  const noPackage = { id: "crm", packageName: "" };
  const empty = validateUploadFiles(makeUpload({ files: [readyFile("a")] }), noPackage);
  assert.ok(!codes(empty.warnings).includes("app_package_mismatch"));
});

test("validateUploadFiles warns about manual version and sdk overrides", () => {
  const upload = makeUpload({
    versionCode: "8",
    minSdk: "24",
    touched: { versionName: false, versionCode: true, minSdk: true },
    files: [readyFile("a")],
  });
  const result = validateUploadFiles(upload, null);
  assert.ok(codes(result.warnings).includes("version_override"));
  assert.ok(codes(result.warnings).includes("sdk_override"));
});

test("validateUploadFiles warns when an existing version differs from the APK", () => {
  const upload = makeUpload({
    existingVersion: true,
    versionName: "0.2.0",
    versionCode: "8",
    files: [
      readyFile("a", {
        metadata: metadata({ versionName: "0.2.0", versionCode: 7 }),
      }),
    ],
  });
  const result = validateUploadFiles(upload, null);
  assert.ok(codes(result.warnings).includes("existing_version_mismatch"));
  assert.deepEqual(computeAllowMismatch(upload), []);
});

test("refreshUploadValidation fills the derived modal fields", () => {
  const upload = makeUpload({
    versionCode: "8",
    touched: { versionName: false, versionCode: true, minSdk: false },
    files: [readyFile("a")],
  });
  const result = refreshUploadValidation(upload, { id: "app", packageName: "com.other" });
  assert.equal(upload.consistency, result);
  assert.equal(upload.inspecting, false);
  assert.deepEqual(upload.allowMismatch, ["version"]);
  assert.match(upload.packageWarning, /com\.example\.app/);
});

/* -------------------------------------------------------------- app match */

test("matchAppByPackage finds the owning app", () => {
  const catalog = [
    { id: "one", packageName: "com.one" },
    { id: "two", packageName: "com.two" },
  ];
  assert.equal(matchAppByPackage(catalog, "com.two")?.id, "two");
  assert.equal(matchAppByPackage(catalog, "com.missing"), null);
  assert.equal(matchAppByPackage(catalog, ""), null);
});

test("selectAppForPackage auto-selects only when the modal is not pinned", () => {
  const catalog = [{ id: "two", packageName: "com.example.app" }];
  const auto = makeUpload({ appId: "one", files: [readyFile("a")] });
  const selection = selectAppForPackage(auto, catalog);
  assert.equal(selection.app.id, "two");
  assert.equal(auto.appId, "two");

  const pinned = makeUpload({ appId: "one", explicitApp: true, files: [readyFile("a")] });
  assert.equal(selectAppForPackage(pinned, catalog), null);
  assert.equal(pinned.appId, "one");

  const touched = makeUpload({ appId: "one", appTouched: true, files: [readyFile("a")] });
  assert.equal(selectAppForPackage(touched, catalog), null);
  assert.equal(touched.appId, "one");

  const missing = makeUpload({ appId: "one", files: [readyFile("a")] });
  const none = selectAppForPackage(missing, [{ id: "x", packageName: "com.other" }]);
  assert.equal(none.app, null);
  assert.equal(none.packageName, "com.example.app");
});
