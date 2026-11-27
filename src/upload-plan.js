/**
 * Pure upload-plan helpers.
 *
 * The APK is the only source of truth: there is no app selector, no editable
 * version/ABI, and no `allow_mismatch` from the dashboard. This module binds a
 * package to an existing catalog app (or plans an auto-created one), validates
 * a multi-APK selection, and computes which ABIs an import would replace.
 *
 * No DOM and no API access so `node --test` covers every rule without a
 * browser.
 */

/**
 * Placeholder apps have no real package yet. New servers persist the binding
 * explicitly as `packageBound`; older servers omit it, so keep the legacy
 * `packageName === id` heuristic for them.
 */
export function isPlaceholderApp(app) {
  if (!app) return true;
  if (app.packageBound === true) return false;
  if (app.packageBound === false) return true;
  const packageName = String(app.packageName || "");
  return packageName === "" || packageName === app.id;
}

/** Deterministic, path-safe app id derived from a package name. */
export function appIdFromPackage(packageName) {
  const text = String(packageName ?? "")
    .trim()
    .toLowerCase();
  if (!text) return "";
  let id = text
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-._]+/, "")
    .replace(/[-._]+$/, "");
  if (!id) id = "app";
  if (!/^[a-z0-9]/.test(id)) id = `app-${id}`;
  return id.slice(0, 64).replace(/[-._]+$/, "") || "app";
}

export function humanizePackage(packageName) {
  const last = String(packageName || "")
    .split(".")
    .findLast(Boolean);
  if (!last) return String(packageName || "Ứng dụng");
  return last
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)\S/g, (match) => match.toUpperCase());
}

/** Server contract: missing versionName falls back to `String(versionCode)`. */
export function effectiveVersionName(metadata) {
  if (!metadata) return null;
  const name = typeof metadata.versionName === "string" ? metadata.versionName : "";
  if (name.trim() !== "") return name;
  if (Number.isInteger(metadata.versionCode)) return String(metadata.versionCode);
  return null;
}

export function effectiveAbi(file) {
  return file?.metadata?.artifactAbi || file?.abi || "universal";
}

function findFile(upload, fileId) {
  if (!upload || !Array.isArray(upload.files)) return null;
  return upload.files.find((file) => file.id === fileId) || null;
}

export function firstInspectedMetadata(upload) {
  const file = (upload?.files || []).find(
    (candidate) => candidate.status === "ready" && candidate.metadata,
  );
  return file?.metadata || null;
}

/** Store a successful inspection. Metadata always wins over the name guess. */
export function applyInspection(upload, fileId, result) {
  const file = findFile(upload, fileId);
  if (!file || !result) return null;
  file.metadata = result;
  file.detectedAbi = result.artifactAbi;
  file.abi = result.artifactAbi;
  file.status = "ready";
  file.error = "";
  file.errorCode = "";
  file.previewUnavailable = false;
  file.previewMessage = "";
  return file;
}

/**
 * A missing DecompressionStream still allows the upload (the server verifies),
 * so it becomes a ready file with no metadata instead of a hard error.
 */
export function applyInspectionError(upload, fileId, error) {
  const file = findFile(upload, fileId);
  if (!file) return null;
  const code = error?.code || "invalid_apk";
  file.metadata = null;
  file.detectedAbi = null;
  if (code === "preview_unavailable") {
    file.status = "ready";
    file.error = "";
    file.errorCode = code;
    file.previewUnavailable = true;
    file.previewMessage = error?.message || "Trình duyệt không xem trước được APK này.";
    return file;
  }
  file.status = "error";
  file.errorCode = code;
  file.previewUnavailable = false;
  file.error = error?.message || "Không đọc được tệp APK.";
  return file;
}

export function matchAppsByPackage(catalog, packageName) {
  if (!packageName) return [];
  return (catalog || []).filter(
    (app) => app && app.packageName === packageName,
  );
}

/**
 * Resolve which app this upload belongs to.
 *
 * Global upload (no `expectedAppId`): the unique catalog app owning the
 * package, otherwise a planned auto-create. Detail upload: the opened app;
 * a real package mismatch is fatal, a placeholder may bind on this upload.
 */
export function resolveUploadTarget(upload, catalog = [], expectedAppId = null) {
  const metadata = firstInspectedMetadata(upload);
  const packageName = metadata?.packageName || null;
  const warnings = [];
  const fatal = [];
  const result = {
    status: "unknown",
    app: null,
    appId: null,
    name: null,
    packageName,
    create: false,
    idHint: null,
    fatal,
    warnings,
  };

  if (expectedAppId) {
    const app = (catalog || []).find((candidate) => candidate.id === expectedAppId);
    if (!app) {
      fatal.push({
        code: "app_not_found",
        message: `Không còn ứng dụng ${expectedAppId} trong danh mục.`,
      });
      result.status = "blocked";
      return result;
    }
    result.app = app;
    result.appId = app.id;
    result.name = app.name;
    if (packageName && !isPlaceholderApp(app) && app.packageName !== packageName) {
      fatal.push({
        code: "detail_package_mismatch",
        message: `APK thuộc ${packageName}, không khớp package ${app.packageName} của ứng dụng đang mở.`,
      });
      result.status = "blocked";
      return result;
    }
    result.status = "existing";
    result.create = false;
    if (packageName && isPlaceholderApp(app)) {
      warnings.push({
        code: "package_bind",
        message: `Package ${packageName} sẽ được gắn vào ${app.name} ở lần tải này.`,
      });
    }
    return result;
  }

  if (!packageName) {
    // The browser could not read the manifest; the server derives the app.
    result.status = "unknown";
    result.create = true;
    return result;
  }

  const matches = matchAppsByPackage(catalog, packageName);
  if (matches.length > 1) {
    fatal.push({
      code: "duplicate_package",
      message: `Có ${matches.length} ứng dụng cùng package ${packageName}: ${matches
        .map((app) => app.id)
        .join(", ")}.`,
    });
    result.status = "blocked";
    return result;
  }
  if (matches.length === 1) {
    result.status = "existing";
    result.app = matches[0];
    result.appId = matches[0].id;
    result.name = matches[0].name;
    result.create = false;
    return result;
  }

  const idHint = appIdFromPackage(packageName);
  const collision = (catalog || []).find((app) => app.id === idHint);
  if (collision) {
    fatal.push({
      code: "app_id_conflict",
      message: `App ID ${idHint} đã được dùng bởi ${collision.name}.`,
    });
    result.status = "blocked";
    result.idHint = idHint;
    return result;
  }
  result.status = "create";
  result.create = true;
  result.idHint = idHint;
  result.name = metadata.label || humanizePackage(packageName);
  result.warnings.push({
    code: "auto_create",
    message: `Ứng dụng ${result.name} sẽ được tạo từ APK.`,
  });
  return result;
}

function distinct(values) {
  return [...new Set(values)];
}

function collectFileIssues(files, fatal, warnings) {
  for (const file of files) {
    if (file.status === "error") {
      fatal.push({
        code: "inspect_error",
        fileId: file.id,
        message: `${file.name}: ${file.error || "không đọc được APK."}`,
      });
      continue;
    }
    if (file.previewUnavailable) {
      warnings.push({
        code: "preview_unavailable",
        fileId: file.id,
        message: `${file.name}: ${file.previewMessage || "không xem trước được trong trình duyệt này."} Máy chủ sẽ xác minh.`,
      });
    }
    if (file.metadata?.configSplit) {
      const split = file.metadata.split ? ` (${file.metadata.split})` : "";
      fatal.push({
        code: "config_split",
        fileId: file.id,
        message: `${file.name} là config split${split}. Chỉ tải base APK.`,
      });
    }
  }
}

function collectDuplicateAbi(files, fatal) {
  const abiFiles = new Map();
  for (const file of files) {
    if (file.status !== "ready") continue;
    const abi = effectiveAbi(file);
    if (!abi) continue;
    const bucket = abiFiles.get(abi) || [];
    bucket.push(file);
    abiFiles.set(abi, bucket);
  }
  for (const [abi, bucket] of abiFiles) {
    if (bucket.length > 1) {
      fatal.push({
        code: "duplicate_abi",
        fileId: bucket[1].id,
        message: `${bucket.length} tệp cùng ABI ${abi}. Mỗi ABI chỉ được một tệp.`,
      });
    }
  }
}

function collectConsistency(files, fatal) {
  const inspected = files.filter((file) => file.status === "ready" && file.metadata);
  const packages = distinct(inspected.map((file) => file.metadata.packageName));
  if (packages.length > 1) {
    fatal.push({
      code: "package_mismatch",
      message: `Các tệp thuộc nhiều package: ${packages.join(", ")}.`,
    });
  }
  const codes = distinct(
    inspected.map((file) => file.metadata.versionCode).filter((value) => value != null),
  );
  if (codes.length > 1) {
    fatal.push({
      code: "version_mismatch",
      message: `Các tệp có versionCode khác nhau: ${codes.join(", ")}.`,
    });
  }
  const names = distinct(
    inspected
      .map((file) => file.metadata.versionName)
      .filter((value) => value != null && value !== ""),
  );
  if (names.length > 1) {
    fatal.push({
      code: "version_mismatch",
      message: `Các tệp có versionName khác nhau: ${names.join(", ")}.`,
    });
  }
  const sdks = distinct(
    inspected.map((file) => file.metadata.minSdk).filter((value) => value != null),
  );
  if (sdks.length > 1) {
    fatal.push({
      code: "sdk_mismatch",
      message: `Các tệp có minSdk khác nhau: ${sdks.join(", ")}.`,
    });
  }
  return { inspected, packages };
}

function collectFlagWarnings(inspected, warnings) {
  for (const file of inspected) {
    if (file.metadata.debuggable) {
      warnings.push({
        code: "debuggable",
        fileId: file.id,
        message: `${file.name} là bản debuggable.`,
      });
    }
    if (file.metadata.testOnly) {
      warnings.push({
        code: "testOnly",
        fileId: file.id,
        message: `${file.name} được đánh dấu testOnly.`,
      });
    }
  }
}

/**
 * @returns {{
 *   fatal: Array<{ code: string, message: string, fileId?: string }>,
 *   warnings: Array<{ code: string, message: string, fileId?: string }>,
 *   inspecting: boolean,
 *   detected: object | null,
 *   target: object,
 * }}
 */
export function validateUploadFiles(upload, catalog = [], expectedAppId = null) {
  const fatal = [];
  const warnings = [];
  const files = Array.isArray(upload?.files) ? upload.files : [];
  const inspecting = files.some((file) => file.status === "inspecting");
  collectFileIssues(files, fatal, warnings);
  collectDuplicateAbi(files, fatal);
  const { inspected, packages } = collectConsistency(files, fatal);
  collectFlagWarnings(inspected, warnings);
  const target = resolveUploadTarget(upload, catalog, expectedAppId);
  fatal.push(...target.fatal);
  if (!files.length) {
    fatal.push({ code: "no_files", message: "Thả ít nhất một tệp APK." });
  }
  if (
    (target.status === "create" && packages.length > 0) ||
    (target.status === "existing" && target.warnings.length)
  ) {
    warnings.push(...target.warnings);
  }
  return {
    fatal,
    warnings,
    inspecting,
    detected: inspected[0]?.metadata || null,
    target,
  };
}

/** Recompute derived modal fields after files change. Mutates presentation only. */
export function refreshUploadValidation(upload, catalog = [], expectedAppId = null) {
  const result = validateUploadFiles(upload, catalog, expectedAppId);
  if (upload) {
    upload.consistency = result;
    upload.inspecting = result.inspecting;
    upload.target = result.target;
    upload.packageWarning = "";
  }
  return result;
}

/**
 * Which artifacts an import would replace. Adding a new ABI never conflicts.
 */
export function computeVersionConflicts(existingVersion, files) {
  const existingAbis = new Set(
    (existingVersion?.artifacts || []).map((artifact) => artifact.abi),
  );
  const replacedAbis = [];
  const newAbis = [];
  for (const file of files || []) {
    const abi = effectiveAbi(file);
    if (!abi) continue;
    if (existingAbis.has(abi)) {
      if (!replacedAbis.includes(abi)) replacedAbis.push(abi);
    } else if (!newAbis.includes(abi)) {
      newAbis.push(abi);
    }
  }
  return { replacedAbis, newAbis, conflict: replacedAbis.length > 0 };
}

/**
 * Final plan for the import. `version` is the value to send to the server
 * (only when the APK resolved it); `conflictVersion` is the name the server
 * would use, so the dashboard can query an existing version first.
 */
export function buildUploadPlan(upload, catalog = [], expectedAppId = null) {
  const validation = validateUploadFiles(upload, catalog, expectedAppId);
  const detected = validation.detected;
  return {
    ...validation,
    ready:
      validation.fatal.length === 0 &&
      !validation.inspecting &&
      (upload?.files?.length || 0) > 0,
    version: detected?.versionName?.trim() ? detected.versionName : null,
    conflictVersion: effectiveVersionName(detected),
    detected,
  };
}
