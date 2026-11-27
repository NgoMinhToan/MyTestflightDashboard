/**
 * Pure upload-modal state helpers.
 *
 * No DOM and no API access, so `node --test` can cover the prefill rules,
 * cross-file consistency checks and ABI overrides without a browser.
 */

export const ALLOW_MISMATCH_ORDER = ["package", "version", "sdk", "abi"];

function findFile(upload, fileId) {
  if (!upload || !Array.isArray(upload.files)) return null;
  return upload.files.find((file) => file.id === fileId) || null;
}

/** Accepts the object used by the modal or a Set for callers that prefer it. */
export function isFieldTouched(touched, field) {
  if (!touched) return false;
  if (typeof touched.has === "function") return touched.has(field);
  return Boolean(touched[field]);
}

function parsePositiveInt(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const parsed = Number.parseInt(text, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function distinct(values) {
  return [...new Set(values)];
}

export function firstInspectedMetadata(upload) {
  const file = (upload?.files || []).find(
    (candidate) => candidate.status === "ready" && candidate.metadata,
  );
  return file?.metadata || null;
}

/**
 * Store a successful inspection. Metadata always wins over the filename
 * guess; only an explicit user choice (`abiOverridden`) is preserved.
 */
export function applyInspection(upload, fileId, result) {
  const file = findFile(upload, fileId);
  if (!file || !result) return null;
  file.metadata = result;
  file.detectedAbi = result.artifactAbi;
  file.status = "ready";
  file.error = "";
  file.errorCode = "";
  file.previewUnavailable = false;
  if (!file.abiOverridden) file.abi = result.artifactAbi;
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
    file.previewMessage =
      error?.message || "Trình duyệt không xem trước được APK này.";
    return file;
  }
  file.status = "error";
  file.errorCode = code;
  file.previewUnavailable = false;
  file.error = error?.message || "Không đọc được tệp APK.";
  return file;
}

/**
 * Fill versionName/versionCode/minSdk from the first inspected APK.
 * Never touches a field the user edited, and never touches a modal opened for
 * an existing version (there the version identity is already fixed).
 */
export function applyPrefill(upload, touched = upload?.touched) {
  const applied = { versionName: false, versionCode: false, minSdk: false };
  if (!upload || upload.existingVersion) return applied;
  const metadata = firstInspectedMetadata(upload);
  if (!metadata) return applied;

  if (
    !isFieldTouched(touched, "versionName") &&
    metadata.versionName != null &&
    upload.versionName !== metadata.versionName
  ) {
    upload.versionName = metadata.versionName;
    applied.versionName = true;
  }
  if (!isFieldTouched(touched, "versionCode") && metadata.versionCode != null) {
    const next = String(metadata.versionCode);
    if (upload.versionCode !== next) {
      upload.versionCode = next;
      applied.versionCode = true;
    }
  }
  if (
    !isFieldTouched(touched, "minSdk") &&
    metadata.minSdk != null &&
    upload.minSdk !== String(metadata.minSdk)
  ) {
    upload.minSdk = String(metadata.minSdk);
    applied.minSdk = true;
  }
  return applied;
}

function versionFieldTouched(upload) {
  return (
    isFieldTouched(upload?.touched, "versionName") ||
    isFieldTouched(upload?.touched, "versionCode")
  );
}

function formVersionDiffers(upload, metadata) {
  if (!metadata) return false;
  const formCode = parsePositiveInt(upload?.versionCode);
  const codeDiff =
    formCode != null &&
    metadata.versionCode != null &&
    formCode !== metadata.versionCode;
  const formName = String(upload?.versionName ?? "").trim();
  const nameDiff =
    metadata.versionName != null &&
    formName !== "" &&
    formName !== metadata.versionName;
  return codeDiff || nameDiff;
}

function formSdkDiffers(upload, metadata) {
  if (metadata?.minSdk == null) return false;
  const formMin = parsePositiveInt(upload?.minSdk);
  return formMin != null && formMin !== metadata.minSdk;
}

/**
 * Which `allow_mismatch` values the upload needs because the user deliberately
 * diverged from what the APK declares. Package mismatches are not auto-allowed:
 * the server's 422 is shown instead.
 */
export function computeAllowMismatch(upload) {
  if (!upload) return [];
  const metadata = firstInspectedMetadata(upload);
  const selected = new Set();
  if (metadata) {
    if (versionFieldTouched(upload) && formVersionDiffers(upload, metadata)) {
      selected.add("version");
    }
    if (
      isFieldTouched(upload.touched, "minSdk") &&
      formSdkDiffers(upload, metadata)
    ) {
      selected.add("sdk");
    }
  }
  for (const file of upload.files || []) {
    if (!file.metadata || file.status === "error") {
      // Without metadata there is no detected ABI, but an explicit select
      // change is still the user's declaration and needs the server's consent.
      if (file.status !== "error" && file.previewUnavailable && file.abiOverridden) {
        selected.add("abi");
      }
      continue;
    }
    if (file.abi !== file.metadata.artifactAbi) selected.add("abi");
  }
  return ALLOW_MISMATCH_ORDER.filter((kind) => selected.has(kind));
}

/** Find the catalog app that owns the inspected package. */
export function matchAppByPackage(catalog, packageName) {
  if (!packageName) return null;
  return (
    (catalog || []).find((app) => app && app.packageName === packageName) || null
  );
}

/**
 * Auto-select the catalog app for the inspected package unless the modal was
 * opened for a specific app or the user already changed the select.
 */
export function selectAppForPackage(upload, catalog) {
  if (!upload || upload.explicitApp || upload.appTouched) return null;
  const metadata = firstInspectedMetadata(upload);
  if (!metadata) return null;
  const match = matchAppByPackage(catalog, metadata.packageName);
  if (match) upload.appId = match.id;
  return { packageName: metadata.packageName, app: match };
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
        message: `${file.name}: ${file.previewMessage || "không xem trước được trong trình duyệt này."} ABI đang lấy từ tên tệp.`,
      });
      if (file.abiOverridden) {
        warnings.push({
          code: "abi_override",
          fileId: file.id,
          message: `${file.name}: ABI ${file.abi} được chọn tay vì không xem trước được APK.`,
        });
      }
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
    // An inspecting file only has the filename guess; wait for metadata.
    if (file.status !== "ready" || !file.abi) continue;
    const bucket = abiFiles.get(file.abi) || [];
    bucket.push(file);
    abiFiles.set(file.abi, bucket);
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
  const inspected = files.filter(
    (file) => file.status === "ready" && file.metadata,
  );
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
    if (file.abi !== file.metadata.artifactAbi) {
      warnings.push({
        code: "abi_override",
        fileId: file.id,
        message: `${file.name}: ABI chọn tay ${file.abi} khác APK (${file.metadata.artifactAbi}).`,
      });
    }
  }
}

function collectAppPackageWarnings(packages, app, warnings) {
  const appPackage =
    app?.packageName && app.packageName !== app.id ? app.packageName : "";
  if (!appPackage) return;
  for (const packageName of packages) {
    if (packageName !== appPackage) {
      warnings.push({
        code: "app_package_mismatch",
        message: `Package APK ${packageName} khác package ứng dụng ${appPackage}.`,
      });
    }
  }
}

function collectFormWarnings(upload, detected, warnings) {
  if (!detected) return;
  const versionTouched = versionFieldTouched(upload);
  if (versionTouched && formVersionDiffers(upload, detected)) {
    warnings.push({
      code: "version_override",
      message:
        "Version trong form khác APK; máy chủ sẽ kiểm tra và cần allow_mismatch=version.",
    });
  } else if (
    !versionTouched &&
    upload?.existingVersion &&
    formVersionDiffers(upload, detected)
  ) {
    warnings.push({
      code: "existing_version_mismatch",
      message:
        "Version của phiên bản đang mở khác APK; máy chủ sẽ từ chối (422). Sửa form hoặc chọn APK khác.",
    });
  }

  const sdkTouched = isFieldTouched(upload?.touched, "minSdk");
  if (sdkTouched && formSdkDiffers(upload, detected)) {
    warnings.push({
      code: "sdk_override",
      message:
        "minSdk trong form khác APK; máy chủ sẽ kiểm tra và cần allow_mismatch=sdk.",
    });
  } else if (
    !sdkTouched &&
    upload?.existingVersion &&
    formSdkDiffers(upload, detected)
  ) {
    warnings.push({
      code: "existing_sdk_mismatch",
      message:
        "minSdk của phiên bản đang mở khác APK; máy chủ sẽ từ chối (422). Sửa minSdk hoặc chọn APK khác.",
    });
  }
}

/**
 * @returns {{
 *   fatal: Array<{ code: string, message: string, fileId?: string }>,
 *   warnings: Array<{ code: string, message: string, fileId?: string }>,
 *   inspecting: boolean,
 *   detected: object | null,
 * }}
 */
export function validateUploadFiles(upload, app = null) {
  const fatal = [];
  const warnings = [];
  const files = Array.isArray(upload?.files) ? upload.files : [];
  const inspecting = files.some((file) => file.status === "inspecting");
  collectFileIssues(files, fatal, warnings);
  collectDuplicateAbi(files, fatal);
  const { inspected, packages } = collectConsistency(files, fatal);
  collectFlagWarnings(inspected, warnings);
  collectAppPackageWarnings(packages, app, warnings);
  const detected = inspected[0]?.metadata || null;
  collectFormWarnings(upload, detected, warnings);
  return { fatal, warnings, inspecting, detected };
}

/**
 * Recompute the derived modal fields after files or form fields change.
 * Mutates only presentation/validation state, never the API payload.
 */
export function refreshUploadValidation(upload, app = null) {
  const result = validateUploadFiles(upload, app);
  if (upload) {
    upload.consistency = result;
    upload.inspecting = result.inspecting;
    upload.allowMismatch = computeAllowMismatch(upload);
    upload.packageWarning = result.warnings
      .filter((warning) => warning.code === "app_package_mismatch")
      .map((warning) => warning.message)
      .join(" ");
  }
  return result;
}
