import test from "node:test";
import assert from "node:assert/strict";

import {
  appIdFromPackage,
  applyInspection,
  applyInspectionError,
  buildUploadPlan,
  computeVersionConflicts,
  effectiveAbi,
  effectiveVersionName,
  humanizePackage,
  isPlaceholderApp,
  refreshUploadValidation,
  resolveUploadTarget,
  validateUploadFiles,
} from "../src/upload-plan.js";

function metadata(overrides = {}) {
  return {
    packageName: "com.example.app",
    versionCode: 7,
    versionName: "1.2.3",
    versionNameSource: "literal",
    label: "Example App",
    minSdk: 26,
    targetSdk: 35,
    abis: ["arm64-v8a"],
    universal: false,
    debuggable: false,
    testOnly: false,
    split: null,
    configSplit: false,
    artifactAbi: "arm64-v8a",
    icon: null,
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
    status: "inspecting",
    metadata: null,
    error: "",
    errorCode: "",
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
    expectedAppId: null,
    files: [],
    consistency: { fatal: [], warnings: [], inspecting: false, detected: null },
    ...overrides,
  };
}

function codes(items) {
  return items.map((item) => item.code);
}

/* ------------------------------------------------------------- inspection */

test("applyInspection stores metadata and trusts the APK ABI", () => {
  const upload = makeUpload({ files: [file("a", { abi: "x86_64" })] });
  const stored = applyInspection(upload, "a", metadata({ artifactAbi: "arm64-v8a" }));
  assert.equal(stored.status, "ready");
  assert.equal(stored.abi, "arm64-v8a");
  assert.equal(stored.detectedAbi, "arm64-v8a");
  assert.equal(stored.metadata.label, "Example App");
});

test("applyInspection clears a previous inspection error", () => {
  const upload = makeUpload({
    files: [file("a", { status: "error", error: "hỏng", errorCode: "invalid_apk" })],
  });
  const stored = applyInspection(upload, "a", metadata());
  assert.equal(stored.status, "ready");
  assert.equal(stored.error, "");
  assert.equal(stored.errorCode, "");
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

/* ------------------------------------------------------------------ names */

test("appIdFromPackage is deterministic and path-safe", () => {
  assert.equal(appIdFromPackage("dev.minhtoan.mytestflight"), "dev.minhtoan.mytestflight");
  assert.equal(appIdFromPackage("com.acme.CRM"), "com.acme.crm");
  assert.equal(appIdFromPackage("com.acme.crm app"), "com.acme.crm-app");
  assert.equal(appIdFromPackage("com/acme/crm"), "com-acme-crm");
  assert.equal(appIdFromPackage("  "), "");
  assert.equal(appIdFromPackage(".hidden"), "hidden");
  assert.equal(appIdFromPackage("9lives.app"), "9lives.app");
});

test("humanizePackage falls back to the last segment", () => {
  assert.equal(humanizePackage("com.acme.crm"), "Crm");
  assert.equal(humanizePackage("dev.minhtoan.my_testflight"), "My Testflight");
  assert.equal(humanizePackage(""), "Ứng dụng");
});

test("effectiveVersionName falls back to versionCode only when empty", () => {
  assert.equal(effectiveVersionName(metadata()), "1.2.3");
  assert.equal(effectiveVersionName(metadata({ versionName: "" })), "7");
  assert.equal(effectiveVersionName(metadata({ versionName: null })), "7");
  assert.equal(effectiveVersionName(null), null);
});

test("isPlaceholderApp honors the explicit packageBound flag", () => {
  assert.equal(
    isPlaceholderApp({
      id: "com.example.raster",
      packageName: "com.example.raster",
      packageBound: true,
    }),
    false,
  );
  assert.equal(
    isPlaceholderApp({
      id: "crm",
      packageName: "com.example.crm",
      packageBound: false,
    }),
    true,
  );
  assert.equal(
    isPlaceholderApp({ id: "x", packageName: "", packageBound: true }),
    false,
  );
});

test("isPlaceholderApp keeps the legacy fallback for older servers", () => {
  assert.equal(isPlaceholderApp({ id: "crm", packageName: "" }), true);
  assert.equal(isPlaceholderApp({ id: "crm", packageName: "crm" }), true);
  assert.equal(isPlaceholderApp({ id: "crm", packageName: "com.acme.crm" }), false);
  assert.equal(isPlaceholderApp(null), true);
});

/* ------------------------------------------------------------ target bind */

test("resolveUploadTarget binds a unique catalog package", () => {
  const catalog = [
    { id: "one", name: "One", packageName: "com.one" },
    { id: "com.example.app", name: "Example", packageName: "com.example.app" },
  ];
  const target = resolveUploadTarget(makeUpload({ files: [readyFile("a")] }), catalog);
  assert.equal(target.status, "existing");
  assert.equal(target.appId, "com.example.app");
  assert.equal(target.create, false);
  assert.deepEqual(target.fatal, []);
});

test("resolveUploadTarget plans an app from the APK label", () => {
  const target = resolveUploadTarget(makeUpload({ files: [readyFile("a")] }), []);
  assert.equal(target.status, "create");
  assert.equal(target.create, true);
  assert.equal(target.appId, null);
  assert.equal(target.idHint, "com.example.app");
  assert.equal(target.name, "Example App");
  assert.equal(target.packageName, "com.example.app");
  assert.deepEqual(codes(target.warnings), ["auto_create"]);
});

test("resolveUploadTarget humanizes the package when the label is missing", () => {
  const file = readyFile("a", { metadata: metadata({ label: null }) });
  const target = resolveUploadTarget(makeUpload({ files: [file] }), []);
  assert.equal(target.name, "App");
});

test("resolveUploadTarget rejects duplicate catalog packages", () => {
  const catalog = [
    { id: "a", name: "A", packageName: "com.example.app" },
    { id: "b", name: "B", packageName: "com.example.app" },
  ];
  const target = resolveUploadTarget(makeUpload({ files: [readyFile("a")] }), catalog);
  assert.equal(target.status, "blocked");
  assert.deepEqual(codes(target.fatal), ["duplicate_package"]);
});

test("resolveUploadTarget accepts a matching real package on the detail page", () => {
  const catalog = [{ id: "example", name: "Example", packageName: "com.example.app" }];
  const upload = makeUpload({ expectedAppId: "example", files: [readyFile("a")] });
  const target = resolveUploadTarget(upload, catalog, "example");
  assert.equal(target.status, "existing");
  assert.equal(target.appId, "example");
});

test("resolveUploadTarget blocks a detail-page package mismatch", () => {
  const catalog = [{ id: "other", name: "Other", packageName: "com.other.app" }];
  const upload = makeUpload({ expectedAppId: "other", files: [readyFile("a")] });
  const target = resolveUploadTarget(upload, catalog, "other");
  assert.equal(target.status, "blocked");
  assert.deepEqual(codes(target.fatal), ["detail_package_mismatch"]);
  assert.match(target.fatal[0].message, /com\.example\.app/);
});

test("a bound app with id === package is not a placeholder", () => {
  const catalog = [
    {
      id: "com.example.raster",
      name: "Raster",
      packageName: "com.example.raster",
      packageBound: true,
    },
  ];
  const upload = makeUpload({
    expectedAppId: "com.example.raster",
    files: [readyFile("a")],
  });
  const target = resolveUploadTarget(upload, catalog, "com.example.raster");
  assert.equal(target.status, "blocked");
  assert.deepEqual(codes(target.fatal), ["detail_package_mismatch"]);
  assert.match(target.fatal[0].message, /com\.example\.app/);

  const validation = validateUploadFiles(upload, catalog, "com.example.raster");
  assert.ok(codes(validation.fatal).includes("detail_package_mismatch"));
});

test("resolveUploadTarget lets a placeholder app bind a real package", () => {
  const catalog = [{ id: "crm", name: "CRM", packageName: "crm" }];
  const upload = makeUpload({ expectedAppId: "crm", files: [readyFile("a")] });
  const target = resolveUploadTarget(upload, catalog, "crm");
  assert.equal(target.status, "existing");
  assert.equal(target.appId, "crm");
  assert.deepEqual(codes(target.warnings), ["package_bind"]);
});

test("packageBound:false still allows a detail placeholder to bind", () => {
  const catalog = [
    {
      id: "crm",
      name: "CRM",
      packageName: "com.acme.crm",
      packageBound: false,
    },
  ];
  const upload = makeUpload({ expectedAppId: "crm", files: [readyFile("a")] });
  const target = resolveUploadTarget(upload, catalog, "crm");
  assert.equal(target.status, "existing");
  assert.equal(target.appId, "crm");
  assert.deepEqual(codes(target.warnings), ["package_bind"]);
});

test("resolveUploadTarget reports a missing detail-page app", () => {
  const upload = makeUpload({ expectedAppId: "gone", files: [readyFile("a")] });
  const target = resolveUploadTarget(upload, [], "gone");
  assert.equal(target.status, "blocked");
  assert.deepEqual(codes(target.fatal), ["app_not_found"]);
});

test("resolveUploadTarget leaves an unreadable APK to the server", () => {
  const entry = file("old", {
    status: "ready",
    metadata: null,
    previewUnavailable: true,
    previewMessage: "Không xem trước được",
  });
  const target = resolveUploadTarget(makeUpload({ files: [entry] }), []);
  assert.equal(target.status, "unknown");
  assert.equal(target.create, true);
  assert.deepEqual(target.fatal, []);
});

test("resolveUploadTarget rejects an app-id collision", () => {
  const catalog = [{ id: "com.example.app", name: "Other", packageName: "com.other.app" }];
  const target = resolveUploadTarget(makeUpload({ files: [readyFile("a")] }), catalog);
  assert.equal(target.status, "blocked");
  assert.deepEqual(codes(target.fatal), ["app_id_conflict"]);
});

/* ------------------------------------------------------------- validation */

test("validateUploadFiles reports inspecting files without failing them", () => {
  const result = validateUploadFiles(makeUpload({ files: [file("a")] }), []);
  assert.equal(result.inspecting, true);
  assert.ok(!codes(result.fatal).includes("inspect_error"));
});

test("validateUploadFiles requires at least one file", () => {
  const result = validateUploadFiles(makeUpload(), []);
  assert.deepEqual(codes(result.fatal), ["no_files"]);
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
  const result = validateUploadFiles(upload, []);
  assert.deepEqual(codes(result.fatal), ["inspect_error", "config_split"]);
});

test("validateUploadFiles rejects duplicate ABIs without dropping a file", () => {
  const upload = makeUpload({ files: [readyFile("a"), readyFile("b")] });
  const result = validateUploadFiles(upload, []);
  assert.deepEqual(codes(result.fatal), ["duplicate_abi"]);
  assert.equal(upload.files.length, 2);
});

test("validateUploadFiles catches package, version and minSdk disagreement", () => {
  const cases = [
    [
      metadata({ packageName: "com.other.app", artifactAbi: "x86_64" }),
      "package_mismatch",
    ],
    [metadata({ versionCode: 8, artifactAbi: "x86_64" }), "version_mismatch"],
    [metadata({ versionName: "2.0.0", artifactAbi: "x86_64" }), "version_mismatch"],
    [metadata({ minSdk: 24, artifactAbi: "x86_64" }), "sdk_mismatch"],
  ];
  for (const [meta, code] of cases) {
    const upload = makeUpload({
      files: [readyFile("a"), readyFile("b", { abi: "x86_64", metadata: meta })],
    });
    assert.ok(codes(validateUploadFiles(upload, []).fatal).includes(code), code);
  }
});

test("validateUploadFiles ignores a null versionName when comparing files", () => {
  const upload = makeUpload({
    files: [
      readyFile("a"),
      readyFile("b", {
        abi: "x86_64",
        metadata: metadata({ versionName: null, artifactAbi: "x86_64" }),
      }),
    ],
  });
  assert.equal(validateUploadFiles(upload, []).fatal.length, 0);
});

test("validateUploadFiles warns about debuggable and testOnly APKs", () => {
  const catalog = [{ id: "example", name: "Example", packageName: "com.example.app" }];
  const upload = makeUpload({
    files: [readyFile("a", { metadata: metadata({ debuggable: true, testOnly: true }) })],
  });
  assert.deepEqual(codes(validateUploadFiles(upload, catalog).warnings), [
    "debuggable",
    "testOnly",
  ]);
});

test("validateUploadFiles warns when the browser could not preview an APK", () => {
  const entry = file("old", {
    status: "ready",
    metadata: null,
    previewUnavailable: true,
    previewMessage: "Trình duyệt cũ",
  });
  const result = validateUploadFiles(makeUpload({ files: [entry] }), []);
  assert.deepEqual(codes(result.warnings), ["preview_unavailable"]);
});

test("validateUploadFiles carries auto-create and detail-binding information", () => {
  const create = validateUploadFiles(makeUpload({ files: [readyFile("a")] }), []);
  assert.equal(create.target.status, "create");
  assert.ok(codes(create.warnings).includes("auto_create"));

  const catalog = [{ id: "crm", name: "CRM", packageName: "crm" }];
  const bind = validateUploadFiles(
    makeUpload({ expectedAppId: "crm", files: [readyFile("a")] }),
    catalog,
    "crm",
  );
  assert.ok(codes(bind.warnings).includes("package_bind"));
});

test("validateUploadFiles includes the detail package mismatch as fatal", () => {
  const catalog = [{ id: "other", name: "Other", packageName: "com.other.app" }];
  const result = validateUploadFiles(
    makeUpload({ expectedAppId: "other", files: [readyFile("a")] }),
    catalog,
    "other",
  );
  assert.ok(codes(result.fatal).includes("detail_package_mismatch"));
});

/* --------------------------------------------------------------- conflicts */

test("computeVersionConflicts separates replaced and new ABIs", () => {
  const existing = {
    artifacts: [{ abi: "arm64-v8a" }, { abi: "x86_64" }],
  };
  const files = [
    readyFile("a", { abi: "arm64-v8a" }),
    readyFile("b", {
      abi: "armeabi-v7a",
      metadata: metadata({ artifactAbi: "armeabi-v7a", abis: ["armeabi-v7a"] }),
    }),
  ];
  const result = computeVersionConflicts(existing, files);
  assert.deepEqual(result.replacedAbis, ["arm64-v8a"]);
  assert.deepEqual(result.newAbis, ["armeabi-v7a"]);
  assert.equal(result.conflict, true);
});

test("computeVersionConflicts does not ask when only new ABIs are added", () => {
  const result = computeVersionConflicts({ artifacts: [{ abi: "arm64-v8a" }] }, [
    readyFile("b", {
      abi: "x86_64",
      metadata: metadata({ artifactAbi: "x86_64", abis: ["x86_64"] }),
    }),
  ]);
  assert.deepEqual(result.replacedAbis, []);
  assert.deepEqual(result.newAbis, ["x86_64"]);
  assert.equal(result.conflict, false);
});

test("computeVersionConflicts handles a missing version", () => {
  const result = computeVersionConflicts(null, [readyFile("a")]);
  assert.deepEqual(result.replacedAbis, []);
  assert.deepEqual(result.newAbis, ["arm64-v8a"]);
  assert.equal(result.conflict, false);
});

test("effectiveAbi falls back to the filename guess", () => {
  assert.equal(effectiveAbi(readyFile("a")), "arm64-v8a");
  assert.equal(effectiveAbi(file("b", { abi: "x86_64" })), "x86_64");
});

/* ------------------------------------------------------------------- plan */

test("buildUploadPlan is ready only when files finished without fatal errors", () => {
  const ready = buildUploadPlan(makeUpload({ files: [readyFile("a")] }), []);
  assert.equal(ready.ready, true);
  assert.equal(ready.version, "1.2.3");
  assert.equal(ready.conflictVersion, "1.2.3");
  assert.equal(ready.target.status, "create");

  const inspecting = buildUploadPlan(makeUpload({ files: [file("a")] }), []);
  assert.equal(inspecting.ready, false);

  const broken = buildUploadPlan(
    makeUpload({ files: [file("bad", { status: "error", error: "hỏng" })] }),
    [],
  );
  assert.equal(broken.ready, false);
});

test("buildUploadPlan omits an unresolved version but keeps the fallback conflict name", () => {
  const file = readyFile("a", { metadata: metadata({ versionName: null, versionCode: 7 }) });
  const plan = buildUploadPlan(makeUpload({ files: [file] }), []);
  assert.equal(plan.version, null);
  assert.equal(plan.conflictVersion, "7");
});

test("buildUploadPlan keeps the normalized version name", () => {
  const file = readyFile("a", { metadata: metadata({ versionName: "1.0.0 (beta)+1" }) });
  const plan = buildUploadPlan(makeUpload({ files: [file] }), []);
  assert.equal(plan.version, "1.0.0 (beta)+1");
});

test("refreshUploadValidation fills consistency and target", () => {
  const catalog = [{ id: "example", name: "Example", packageName: "com.example.app" }];
  const upload = makeUpload({ files: [readyFile("a")] });
  const result = refreshUploadValidation(upload, catalog);
  assert.equal(upload.consistency, result);
  assert.equal(upload.inspecting, false);
  assert.equal(upload.target.status, "existing");
  assert.equal(upload.target.appId, "example");
});

test("refreshUploadValidation blocks a detail-page package mismatch", () => {
  const catalog = [{ id: "other", name: "Other", packageName: "com.other.app" }];
  const upload = makeUpload({ expectedAppId: "other", files: [readyFile("a")] });
  const result = refreshUploadValidation(upload, catalog, "other");
  assert.equal(upload.target.status, "blocked");
  assert.ok(codes(result.fatal).includes("detail_package_mismatch"));
});
