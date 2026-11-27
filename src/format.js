export const ABI_META = {
  universal: { label: "Universal", short: "uni", cls: "u" },
  "arm64-v8a": { label: "arm64-v8a", short: "arm64", cls: "a64" },
  "armeabi-v7a": { label: "armeabi-v7a", short: "armv7", cls: "a7" },
  x86_64: { label: "x86_64", short: "x86_64", cls: "x64" },
  x86: { label: "x86", short: "x86", cls: "x86" },
  riscv64: { label: "riscv64", short: "riscv", cls: "riscv" },
  armeabi: { label: "armeabi", short: "armeabi", cls: "armeabi" },
};

export const ABI_ORDER = [
  "universal",
  "arm64-v8a",
  "armeabi-v7a",
  "x86_64",
  "x86",
  "riscv64",
  "armeabi",
];

export const MX_ABIS = ["universal", "arm64-v8a", "armeabi-v7a", "x86_64"];

const PALETTE = [
  "#FFD66B",
  "#9AD8FF",
  "#C8F0CE",
  "#F9B9E8",
  "#D8CBFF",
  "#A8E6DC",
  "#E2F2A8",
  "#E8E4DE",
];

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function esc(value) {
  return String(value == null ? "" : value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char],
  );
}

export function compareVersions(left, right) {
  return (
    (right.code || 0) - (left.code || 0) ||
    collator.compare(right.name || "", left.name || "")
  );
}

export function sortedVersions(versions) {
  return (versions || []).slice().sort(compareVersions);
}

export function published(app) {
  return (app?.versions || []).filter((version) => version.artifacts.length > 0);
}

export function latestOf(app) {
  return sortedVersions(published(app))[0] || null;
}

export function draftCount(app) {
  return (app?.versions || []).filter((version) => version.artifacts.length === 0).length;
}

export function totalBytes(app) {
  return (app?.versions || []).reduce(
    (sum, version) =>
      sum + version.artifacts.reduce((inner, artifact) => inner + (artifact.sizeBytes || 0), 0),
    0,
  );
}

export function apkCount(app) {
  return (app?.versions || []).reduce(
    (sum, version) => sum + version.artifacts.length,
    0,
  );
}

export function defaultArtifact(version) {
  if (!version?.artifacts?.length) return null;
  return version.artifacts.find((artifact) => artifact.abi === "universal") || version.artifacts[0];
}

export function fmtNumber(value) {
  return (Math.round(Number(value || 0) * 10) / 10).toString().replace(".", ",");
}

export function fmtSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0 MB";
  const mb = value / (1024 * 1024);
  if (mb >= 1024) return `${fmtNumber(mb / 1024)} GB`;
  if (mb < 0.1) return "< 0,1 MB";
  return `${fmtNumber(mb)} MB`;
}

export function fmtDate(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

export function relativeTime(iso) {
  if (!iso) return "chưa có";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "chưa có";
  const delta = Date.now() - date.getTime();
  if (delta < 0) return "vừa xong";
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ngày trước`;
  return fmtDate(iso);
}

export function toDateInput(iso) {
  if (!iso) return todayDateInput();
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return todayDateInput();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function todayDateInput() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Local noon avoids a date shifting backwards in UTC on negative offsets. */
export function isoFromDateInput(value) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function shortSha(sha) {
  if (!sha) return "—";
  return String(sha).slice(0, 12);
}

export function abiMeta(abi) {
  return ABI_META[abi] || { label: abi, short: abi, cls: "more" };
}

export function abiChip(abi) {
  const meta = abiMeta(abi);
  return `<span class="abi ${meta.cls}">${esc(meta.label)}</span>`;
}

export function abiChips(artifacts, limit = 2) {
  const list = artifacts || [];
  if (!list.length) return `<span class="abi draft">Chưa có APK</span>`;
  const shown = list.slice(0, limit).map((artifact) => abiChip(artifact.abi)).join("");
  const rest = list.length > limit ? `<span class="abi more">+${list.length - limit}</span>` : "";
  return shown + rest;
}

export function appColor(id) {
  const value = String(id || "");
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

export function initialOf(app) {
  const name = String(app?.name || app?.id || "?").trim();
  return esc(name.charAt(0).toUpperCase() || "?");
}

export function iconInner(app) {
  const letter = `<span class="letter" aria-hidden="true">${initialOf(app)}</span>`;
  if (!app?.iconUrl) return letter;
  return `${letter}<img src="${esc(app.iconUrl)}" alt="" loading="lazy" decoding="async" onerror="this.remove()">`;
}

export function suggestVersion(app) {
  const versions = sortedVersions(app?.versions);
  const top = versions[0];
  if (!top) return "1.0.0";
  const raw = String(top.name || "");
  const [base, ...suffixParts] = raw.split("-");
  const suffix = suffixParts.length ? `-${suffixParts.join("-")}` : "";
  const parts = base.split(".").map((part) => parseInt(part, 10));
  if (!parts.length || parts.some((part) => Number.isNaN(part))) return "1.0.0";
  while (parts.length < 3) parts.push(0);
  parts[parts.length - 1] += 1;
  return `${parts.join(".")}${suffix}`;
}

/**
 * A temporary guess used only until the browser reads the APK, or when
 * `DecompressionStream` is unavailable. Metadata from `apk-inspect.js` always
 * wins; the server verifies the declared ABI either way.
 */
export function inferAbi(filename) {
  const name = String(filename || "").toLowerCase();
  if (name.includes("universal")) return "universal";
  if (name.includes("x86_64") || name.includes("x86-64")) return "x86_64";
  if (name.includes("arm64") || name.includes("aarch64")) return "arm64-v8a";
  if (name.includes("armeabi-v7a") || name.includes("armv7")) return "armeabi-v7a";
  if (name.includes("riscv64")) return "riscv64";
  if (/\bx86\b/.test(name) || name.includes("-x86.") || name.includes("-x86-")) return "x86";
  if (name.includes("armeabi")) return "armeabi";
  return "arm64-v8a";
}

export function errorMessage(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  return error.message || "Có lỗi xảy ra.";
}

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
