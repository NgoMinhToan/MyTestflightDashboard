/**
 * Read the identity of an APK without uploading it.
 *
 * Pure ESM with no DOM or Node dependencies beyond platform globals:
 *   - the ZIP primitives live in `apk-archive.js`
 *   - `resources.arsc` and binary XML live in `apk-resources.js`
 *   - this module extracts package/version/SDK/ABI plus the resolved label,
 *     version-name source and launcher-icon descriptor
 *
 * Resource resolution is best-effort: a missing or corrupt ARSC leaves the
 * label/icon unavailable but never fails the inspection.
 */

import {
  ApkInspectError,
  collectAbis,
  createEntryReader,
  fail,
  findEndOfCentralDirectory,
  openSource,
  parseEndOfCentralDirectory,
  parseStringPool,
  readCentralDirectory,
  readEntryBytes,
  readU16,
  readU32,
} from "./apk-archive.js";
import {
  iconKindFromElement,
  MAX_ARSC_COMPRESSED,
  MAX_ARSC_INFLATED,
  MAX_XML_COMPRESSED,
  MAX_XML_INFLATED,
  parseBinaryXml,
  parseResTable,
  rasterContentType,
  resolveIconResource,
  resolveLabel,
  resolveVersionName,
} from "./apk-resources.js";

export { ApkInspectError } from "./apk-archive.js";
export { APK_ABI_ORDER } from "./apk-archive.js";

const MAX_COMPRESSED_MANIFEST = 16 * 1024 * 1024;
const MAX_INFLATED_MANIFEST = 8 * 1024 * 1024;

const AXML_FILE = 0x0003;
const AXML_STRING_POOL = 0x0001;
const AXML_START_ELEMENT = 0x0102;

const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_INT_BOOLEAN = 0x12;

/* ---------------------------------------------------------------- AXML */

function parseStartElement(bytes, start, chunkSize, pool) {
  if (chunkSize < 16 + 20) return { name: null, attrs: [] };
  const nameIndex = readU32(bytes, start + 20);
  const attributeStart = readU16(bytes, start + 24);
  const attributeSize = readU16(bytes, start + 26);
  const attributeCount = readU16(bytes, start + 28);
  if (
    nameIndex == null ||
    attributeStart == null ||
    attributeSize == null ||
    attributeCount == null
  ) {
    fail("invalid_apk", "Start element AXML bị hỏng.");
  }
  const stride = attributeSize >= 20 ? attributeSize : 20;
  const attributesBase = start + 16 + (attributeStart || 20);
  const chunkEnd = start + chunkSize;
  const attrs = [];
  for (let index = 0; index < attributeCount; index += 1) {
    const offset = attributesBase + index * stride;
    if (offset + 20 > chunkEnd) break;
    const name = readU32(bytes, offset + 4);
    const rawIndex = readU32(bytes, offset + 8);
    const dataType = bytes[offset + 15];
    const data = readU32(bytes, offset + 16);
    if (name == null || rawIndex == null || data == null) {
      fail("invalid_apk", "Attribute AXML bị hỏng.");
    }
    attrs.push({
      name: pool.get(name) || "",
      raw: rawIndex === 0xffffffff ? null : pool.get(rawIndex),
      dataType,
      data: data >>> 0,
      stringValue: dataType === TYPE_STRING ? pool.get(data) : null,
    });
  }
  return { name: pool.get(nameIndex), attrs };
}

function attributeOf(attrs, name) {
  return (attrs || []).find((attribute) => attribute.name === name) || null;
}

/** Typed value wins; rawValue is only a fallback for untyped attributes. */
function stringOf(attribute) {
  if (!attribute) return null;
  if (attribute.dataType === TYPE_STRING) return attribute.stringValue;
  if (attribute.dataType === TYPE_REFERENCE) return null;
  return attribute.raw;
}

function refOf(attribute) {
  if (!attribute || attribute.dataType !== TYPE_REFERENCE) return null;
  return attribute.data >>> 0 || null;
}

function intOf(attribute) {
  if (!attribute) return null;
  if (attribute.dataType === TYPE_INT_DEC || attribute.dataType === TYPE_INT_HEX) {
    return attribute.data | 0;
  }
  if (attribute.dataType === TYPE_INT_BOOLEAN) return attribute.data !== 0 ? 1 : 0;
  if (attribute.dataType === TYPE_REFERENCE) return null;
  if (attribute.raw != null && /^-?\d+$/.test(attribute.raw.trim())) {
    return Number.parseInt(attribute.raw.trim(), 10) | 0;
  }
  return null;
}

function boolOf(attribute) {
  if (!attribute) return false;
  if (attribute.dataType === TYPE_INT_BOOLEAN) return attribute.data !== 0;
  if (attribute.dataType === TYPE_INT_DEC || attribute.dataType === TYPE_INT_HEX) {
    return attribute.data !== 0;
  }
  if (attribute.dataType === TYPE_REFERENCE) return false;
  if (attribute.raw != null) {
    const value = attribute.raw.trim().toLowerCase();
    return value === "true" || value === "1";
  }
  return false;
}

function parseAxml(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) {
    fail("invalid_apk", "AndroidManifest.xml quá nhỏ.");
  }
  if (readU16(bytes, 0) !== AXML_FILE) {
    fail("invalid_apk", "AndroidManifest.xml không phải binary XML.");
  }
  const headerSize = readU16(bytes, 2);
  if (headerSize == null || headerSize < 8) {
    fail("invalid_apk", "Header AXML bị hỏng.");
  }

  let pool = null;
  let cursor = headerSize;
  while (pool == null && cursor + 8 <= bytes.length) {
    const type = readU16(bytes, cursor);
    const chunkHeaderSize = readU16(bytes, cursor + 2);
    const chunkSize = readU32(bytes, cursor + 4);
    if (
      type == null ||
      chunkHeaderSize == null ||
      chunkSize == null ||
      chunkSize < 8 ||
      cursor + chunkSize > bytes.length
    ) {
      fail("invalid_apk", "Chunk AXML bị hỏng.");
    }
    if (type === AXML_STRING_POOL) {
      pool = parseStringPool(bytes, cursor, chunkHeaderSize, chunkSize);
    }
    cursor += chunkSize;
  }
  if (!pool) fail("invalid_apk", "AndroidManifest.xml thiếu string pool.");

  const manifestAttributes = [];
  const usesSdkAttributes = [];
  const applicationAttributes = [];
  let sawManifest = false;

  cursor = headerSize;
  while (cursor + 8 <= bytes.length) {
    const type = readU16(bytes, cursor);
    const chunkSize = readU32(bytes, cursor + 4);
    if (
      type == null ||
      chunkSize == null ||
      chunkSize < 8 ||
      cursor + chunkSize > bytes.length
    ) {
      fail("invalid_apk", "Chunk AXML bị hỏng.");
    }
    if (type === AXML_START_ELEMENT) {
      const element = parseStartElement(bytes, cursor, chunkSize, pool);
      if (element.name === "manifest") {
        sawManifest = true;
        manifestAttributes.push(...element.attrs);
      } else if (element.name === "uses-sdk") {
        usesSdkAttributes.push(...element.attrs);
      } else if (element.name === "application") {
        applicationAttributes.push(...element.attrs);
      }
    }
    cursor += chunkSize;
  }
  if (!sawManifest) fail("invalid_apk", "AndroidManifest.xml thiếu phần tử manifest.");

  const packageName = stringOf(attributeOf(manifestAttributes, "package"));
  if (!packageName) {
    fail("invalid_apk", "AndroidManifest.xml thiếu package.");
  }
  const versionCode = intOf(attributeOf(manifestAttributes, "versionCode"));
  if (!Number.isInteger(versionCode) || versionCode <= 0) {
    fail("invalid_apk", "AndroidManifest.xml có versionCode không hợp lệ.");
  }
  const versionNameAttribute = attributeOf(manifestAttributes, "versionName");
  const versionNameLiteral = stringOf(versionNameAttribute);
  const versionNameRef = refOf(versionNameAttribute);
  const split = stringOf(attributeOf(manifestAttributes, "split"));
  const configForSplit = attributeOf(manifestAttributes, "configForSplit");
  const minSdk = intOf(attributeOf(usesSdkAttributes, "minSdkVersion"));
  const targetSdk = intOf(attributeOf(usesSdkAttributes, "targetSdkVersion"));

  const labelAttribute = attributeOf(applicationAttributes, "label");
  const labelLiteral = stringOf(labelAttribute);
  const labelRef = refOf(labelAttribute);
  const iconAttribute = attributeOf(applicationAttributes, "icon");
  const iconRef = refOf(iconAttribute);
  const roundIconAttribute = attributeOf(applicationAttributes, "roundIcon");
  const roundIconRef = refOf(roundIconAttribute);

  return {
    packageName,
    versionCode,
    // An empty android:versionName behaves like a missing one.
    versionNameLiteral: versionNameLiteral ? versionNameLiteral : null,
    versionNameRef,
    minSdk: Number.isInteger(minSdk) ? minSdk : null,
    targetSdk: Number.isInteger(targetSdk) ? targetSdk : null,
    debuggable: boolOf(attributeOf(applicationAttributes, "debuggable")),
    testOnly: boolOf(attributeOf(applicationAttributes, "testOnly")),
    split: split || null,
    configSplit: Boolean(split && split.startsWith("config.")) || Boolean(configForSplit),
    labelLiteral,
    labelRef,
    iconRef,
    roundIconRef,
  };
}

/* ---------------------------------------------------------------- icons */

async function iconFromTable(table, resourceId, readEntry) {
  if (!table || !resourceId) return null;
  try {
    const resource = resolveIconResource(table, resourceId, { prefer: "xml" });
    if (!resource) return null;
    if (resource.kind === "xml") {
      const bytes = await readEntry(resource.entry, {
        maxCompressed: MAX_XML_COMPRESSED,
        maxInflated: MAX_XML_INFLATED,
      });
      if (!bytes) return null;
      const root = parseBinaryXml(bytes);
      const kind = iconKindFromElement(root);
      if (kind !== "adaptive" && kind !== "vector") return null;
      return { kind, entry: resource.entry, resourceId: resource.resourceId };
    }
    const contentType = rasterContentType(resource.entry);
    if (!contentType) return null;
    return {
      kind: "raster",
      entry: resource.entry,
      contentType,
      resourceId: resource.resourceId,
      density: resource.density,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------- API */

/**
 * @param {File | Blob | Uint8Array | ArrayBuffer | DataView} source
 * @returns {Promise<{
 *   packageName: string,
 *   versionCode: number,
 *   versionName: string | null,
 *   versionNameSource: "literal" | "resource" | "none",
 *   label: string | null,
 *   minSdk: number | null,
 *   targetSdk: number | null,
 *   abis: string[],
 *   universal: boolean,
 *   debuggable: boolean,
 *   testOnly: boolean,
 *   split: string | null,
 *   configSplit: boolean,
 *   artifactAbi: string,
 *   icon: object | null,
 * }>}
 */
export async function inspectApk(source, options = {}) {
  const reader = await openSource(source);
  const eocd = await findEndOfCentralDirectory(reader);
  const { entries, directorySize, directoryOffset } = parseEndOfCentralDirectory(
    eocd.tail,
    eocd.index,
  );
  const archiveEntries = await readCentralDirectory(
    reader,
    directoryOffset,
    directorySize,
    entries,
  );
  const manifestEntry = archiveEntries.find((entry) => entry.name === "AndroidManifest.xml");
  if (!manifestEntry) fail("invalid_apk", "APK thiếu AndroidManifest.xml.");
  const abis = collectAbis(archiveEntries);
  const manifest = parseAxml(
    await readEntryBytes(reader, manifestEntry, {
      maxCompressed: MAX_COMPRESSED_MANIFEST,
      maxInflated: MAX_INFLATED_MANIFEST,
      label: "AndroidManifest.xml",
    }),
  );

  let table = null;
  if (options.parseResources !== false) {
    const arscEntry = archiveEntries.find((entry) => entry.name === "resources.arsc");
    if (arscEntry) {
      try {
        table = parseResTable(
          await readEntryBytes(reader, arscEntry, {
            maxCompressed: MAX_ARSC_COMPRESSED,
            maxInflated: MAX_ARSC_INFLATED,
            label: "resources.arsc",
          }),
        );
      } catch {
        table = null;
      }
    }
  }

  const readEntry = createEntryReader(reader, archiveEntries);
  let label = manifest.labelLiteral;
  if (!label && manifest.labelRef) {
    try {
      label = resolveLabel(table, manifest.labelRef);
    } catch {
      label = null;
    }
  }

  let versionName = manifest.versionNameLiteral;
  let versionNameSource = "literal";
  if (!versionName && manifest.versionNameRef) {
    try {
      versionName = resolveVersionName(table, manifest.versionNameRef);
    } catch {
      versionName = null;
    }
    versionNameSource = versionName ? "resource" : "none";
  } else if (!versionName) {
    versionNameSource = "none";
  }

  let icon = null;
  const iconRef = manifest.iconRef || manifest.roundIconRef;
  if (iconRef) icon = await iconFromTable(table, iconRef, readEntry);

  const universal = abis.length !== 1;
  const metadata = {
    packageName: manifest.packageName,
    versionCode: manifest.versionCode,
    versionName: versionName || null,
    versionNameSource,
    label: label || null,
    minSdk: manifest.minSdk,
    targetSdk: manifest.targetSdk,
    abis,
    universal,
    debuggable: manifest.debuggable,
    testOnly: manifest.testOnly,
    split: manifest.split,
    configSplit: manifest.configSplit,
    artifactAbi: universal ? "universal" : abis[0],
    icon,
  };
  // Internal, non-contract handles for the icon preview. Non-enumerable so
  // metadata comparisons and JSON serialisation stay clean.
  Object.defineProperty(metadata, "resources", {
    value: { table, readEntry },
    enumerable: false,
    configurable: true,
  });
  return metadata;
}

export function artifactAbiOf(metadata) {
  const abis = Array.isArray(metadata?.abis) ? metadata.abis : [];
  return abis.length === 1 ? abis[0] : "universal";
}
