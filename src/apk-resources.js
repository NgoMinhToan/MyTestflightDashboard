/**
 * `resources.arsc` + Android binary XML readers.
 *
 * The dashboard runs the same resolution as the server so the APK is the only
 * source of truth for the label, versionName and launcher icon. Everything is
 * best-effort: a broken table or missing resource makes that value unavailable
 * and never fails the APK inspection.
 */

import {
  ApkInspectError,
  fail,
  readF32,
  readU16,
  readU32,
  parseStringPool,
} from "./apk-archive.js";

const AXML_FILE = 0x0003;
const AXML_STRING_POOL = 0x0001;
const AXML_RESOURCE_MAP = 0x0180;
const AXML_START_NAMESPACE = 0x0100;
const AXML_END_NAMESPACE = 0x0101;
const AXML_START_ELEMENT = 0x0102;
const AXML_END_ELEMENT = 0x0103;
const AXML_CDATA = 0x0104;

const RES_TABLE = 0x0002;
const RES_TABLE_PACKAGE = 0x0200;
const RES_TABLE_TYPE = 0x0201;
const RES_TABLE_TYPE_SPEC = 0x0202;

const TYPE_NULL = 0x00;
const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;
const TYPE_FLOAT = 0x04;
const TYPE_DIMENSION = 0x05;
const TYPE_FRACTION = 0x06;
const TYPE_INT_DEC = 0x10;
const TYPE_INT_HEX = 0x11;
const TYPE_INT_BOOLEAN = 0x12;
const TYPE_INT_COLOR_ARGB8 = 0x1c;
const TYPE_INT_COLOR_RGB8 = 0x1d;
const TYPE_INT_COLOR_ARGB4 = 0x1e;
const TYPE_INT_COLOR_RGB4 = 0x1f;

export const MAX_ARSC_COMPRESSED = 32 * 1024 * 1024;
export const MAX_ARSC_INFLATED = 64 * 1024 * 1024;
export const MAX_XML_COMPRESSED = 2 * 1024 * 1024;
export const MAX_XML_INFLATED = 4 * 1024 * 1024;
export const MAX_RASTER_ICON_BYTES = 2 * 1024 * 1024;

const MAX_RESOURCE_TYPES = 256;
const MAX_RESOURCE_ENTRIES = 100000;
const MAX_REFERENCE_DEPTH = 8;

/* ------------------------------------------------------------------ colors */

/** Android colours are #AARRGGBB; CSS is #RRGGBB plus an opacity. */
export function parseColor(value) {
  if (typeof value === "number") return argbToCss(value >>> 0);
  const text = String(value ?? "").trim();
  const match = /^#([0-9a-fA-F]{3,8})$/.exec(text);
  if (!match) return null;
  const digits = match[1];
  if (digits.length === 3) {
    const [r, g, b] = digits.split("");
    return { hex: `#${r}${r}${g}${g}${b}${b}`, alpha: 1, css: `#${r}${r}${g}${g}${b}${b}` };
  }
  if (digits.length === 6) {
    return { hex: `#${digits}`, alpha: 1, css: `#${digits}` };
  }
  if (digits.length === 8) return argbToCss(Number.parseInt(digits, 16) >>> 0);
  return null;
}

export function argbToCss(value) {
  const argb = value >>> 0;
  const alpha = ((argb >>> 24) & 0xff) / 255;
  const hex = `#${((argb >>> 0) & 0xffffff).toString(16).padStart(6, "0")}`;
  return { hex, alpha, css: alpha >= 1 ? hex : hex };
}

function isColorType(type) {
  return (
    type === TYPE_INT_COLOR_ARGB8 ||
    type === TYPE_INT_COLOR_RGB8 ||
    type === TYPE_INT_COLOR_ARGB4 ||
    type === TYPE_INT_COLOR_RGB4
  );
}

/* --------------------------------------------------------------- configs */

function unpackLocale(bytes, offset) {
  const first = readU16(bytes, offset);
  if (first == null || first === 0) return "";
  const low = first & 0xff;
  const high = (first >>> 8) & 0xff;
  if (low & 0x80) {
    // Android packs three-letter codes in base 31 (one bit in each byte).
    const a = high & 0x1f;
    const b = ((high & 0xe0) >>> 5) | ((low & 0x03) << 3);
    const c = (low & 0x7c) >>> 2;
    return String.fromCharCode(a + 0x61, b + 0x61, c + 0x61);
  }
  const text = String.fromCharCode(low, high);
  return text.replace(/\0/g, "");
}

function parseConfig(bytes, start) {
  const size = readU32(bytes, start) ?? 0;
  const mcc = readU16(bytes, start + 4) ?? 0;
  const mnc = readU16(bytes, start + 6) ?? 0;
  const language = unpackLocale(bytes, start + 8);
  const country = unpackLocale(bytes, start + 10);
  const orientation = bytes[start + 12] ?? 0;
  const touchscreen = bytes[start + 13] ?? 0;
  const density = readU16(bytes, start + 14) ?? 0;
  const keyboard = bytes[start + 16] ?? 0;
  const navigation = bytes[start + 17] ?? 0;
  const inputFlags = bytes[start + 18] ?? 0;
  const screenWidth = readU16(bytes, start + 20) ?? 0;
  const screenHeight = readU16(bytes, start + 22) ?? 0;
  const sdkVersion = readU16(bytes, start + 24) ?? 0;
  const minorVersion = readU16(bytes, start + 26) ?? 0;
  const screenLayout = bytes[start + 28] ?? 0;
  const uiMode = bytes[start + 29] ?? 0;
  const smallestScreenWidthDp = readU16(bytes, start + 30) ?? 0;
  const screenWidthDp = readU16(bytes, start + 32) ?? 0;
  const screenHeightDp = readU16(bytes, start + 34) ?? 0;
  const screenLayout2 = bytes[start + 48] ?? 0;
  const colorMode = bytes[start + 49] ?? 0;
  return {
    size,
    mcc,
    mnc,
    language,
    country,
    orientation,
    touchscreen,
    density,
    keyboard,
    navigation,
    inputFlags,
    screenWidth,
    screenHeight,
    sdkVersion,
    minorVersion,
    screenLayout,
    uiMode,
    smallestScreenWidthDp,
    screenWidthDp,
    screenHeightDp,
    screenLayout2,
    colorMode,
  };
}

function qualifierCount(config) {
  let count = 0;
  if (config.mcc) count += 1;
  if (config.mnc) count += 1;
  if (config.language) count += 1;
  if (config.country) count += 1;
  if (config.orientation) count += 1;
  if (config.touchscreen) count += 1;
  if (config.density) count += 1;
  if (config.keyboard) count += 1;
  if (config.navigation) count += 1;
  if (config.inputFlags) count += 1;
  if (config.screenWidth) count += 1;
  if (config.screenHeight) count += 1;
  if (config.sdkVersion) count += 1;
  if (config.minorVersion) count += 1;
  if (config.screenLayout) count += 1;
  if (config.uiMode) count += 1;
  if (config.smallestScreenWidthDp) count += 1;
  if (config.screenWidthDp) count += 1;
  if (config.screenHeightDp) count += 1;
  if (config.screenLayout2) count += 1;
  if (config.colorMode) count += 1;
  return count;
}

function configKey(config) {
  return [
    config.language,
    config.country,
    config.density,
    config.sdkVersion,
    config.screenWidth,
    config.screenHeight,
    config.orientation,
    config.uiMode,
  ].join("-");
}

/**
 * Default locale wins, then `en`, then the fewest qualifiers. Remaining ties
 * are broken deterministically so two runs always pick the same entry.
 */
function compareConfigs(left, right, { preferDensity = false } = {}) {
  const localeRank = (config) => (config.language === "" ? 0 : config.language === "en" ? 1 : 2);
  const locale = localeRank(left.config) - localeRank(right.config);
  if (locale !== 0) return locale;
  if (preferDensity) {
    const density = (right.config.density || 0) - (left.config.density || 0);
    if (density !== 0) return density;
  }
  const qualifiers = qualifierCount(left.config) - qualifierCount(right.config);
  if (qualifiers !== 0) return qualifiers;
  return configKey(left.config).localeCompare(configKey(right.config));
}

/* ------------------------------------------------------------- res table */

function parsePackage(bytes, start, headerSize, chunkSize, table) {
  const packageId = readU32(bytes, start + 8) ?? 0;
  const packageEnd = start + chunkSize;
  let name = "";
  for (let index = 0; index < 128; index += 1) {
    const code = readU16(bytes, start + 12 + index * 2);
    if (code == null || code === 0) break;
    name += String.fromCharCode(code);
  }
  const typeStringsOffset = readU32(bytes, start + 268);
  const keyStringsOffset = readU32(bytes, start + 276);
  let typeStrings = null;
  let keyStrings = null;
  if (typeStringsOffset != null) {
    const absolute = start + typeStringsOffset;
    const type = readU16(bytes, absolute);
    const childHeader = readU16(bytes, absolute + 2);
    const childSize = readU32(bytes, absolute + 4);
    if (type === AXML_STRING_POOL && childSize != null && childSize >= 8) {
      typeStrings = parseStringPool(bytes, absolute, childHeader, childSize);
    }
  }
  if (keyStringsOffset != null) {
    const absolute = start + keyStringsOffset;
    const type = readU16(bytes, absolute);
    const childHeader = readU16(bytes, absolute + 2);
    const childSize = readU32(bytes, absolute + 4);
    if (type === AXML_STRING_POOL && childSize != null && childSize >= 8) {
      keyStrings = parseStringPool(bytes, absolute, childHeader, childSize);
    }
  }

  let cursor = start + headerSize;
  let types = 0;
  while (cursor + 8 <= packageEnd) {
    const type = readU16(bytes, cursor);
    const childHeader = readU16(bytes, cursor + 2);
    const childSize = readU32(bytes, cursor + 4);
    if (
      type == null ||
      childHeader == null ||
      childSize == null ||
      childSize < 8 ||
      cursor + childSize > packageEnd
    ) {
      fail("invalid_apk", "Chunk resources.arsc bị hỏng.");
    }
    if (type === RES_TABLE_TYPE) {
      types += 1;
      if (types > MAX_RESOURCE_TYPES) {
        fail("invalid_apk", "resources.arsc có quá nhiều loại tài nguyên.");
      }
      parseTypeChunk(bytes, cursor, childHeader, childSize, {
        packageId,
        table,
        typeStrings,
        keyStrings,
        packageEnd: start + chunkSize,
      });
    }
    cursor += childSize;
  }
  return { id: packageId, name, typeStrings, keyStrings };
}

function parseTypeChunk(
  bytes,
  start,
  headerSize,
  chunkSize,
  { packageId, table, typeStrings, keyStrings, packageEnd },
) {
  const typeId = bytes[start + 8];
  const entryCount = readU32(bytes, start + 12);
  const entriesStart = readU32(bytes, start + 16);
  if (typeId == null || entryCount == null || entriesStart == null) {
    fail("invalid_apk", "Type chunk resources.arsc bị hỏng.");
  }
  if (entryCount > MAX_RESOURCE_ENTRIES) {
    fail("invalid_apk", "resources.arsc có quá nhiều entry.");
  }
  const config = parseConfig(bytes, start + 20);
  const typeName = typeStrings?.get(typeId - 1) || "";
  const offsetsStart = start + headerSize;
  const entriesBase = start + entriesStart;
  const chunkEnd = Math.min(start + chunkSize, packageEnd);
  for (let index = 0; index < entryCount; index += 1) {
    const offset = readU32(bytes, offsetsStart + index * 4);
    if (offset == null || offset === 0xffffffff) continue;
    const entryPos = entriesBase + offset;
    if (entryPos + 8 > chunkEnd) continue;
    const entrySize = readU16(bytes, entryPos);
    const flags = readU16(bytes, entryPos + 2);
    const keyIndex = readU32(bytes, entryPos + 4);
    if (entrySize == null || entrySize < 8) continue;
    // Complex (map) entries are not used by labels, version names or icons.
    if ((flags || 0) & 0x0001) continue;
    const valuePos = entryPos + entrySize;
    if (valuePos + 8 > chunkEnd) continue;
    const type = bytes[valuePos + 3];
    const data = readU32(bytes, valuePos + 4);
    if (type == null || data == null) continue;
    const resourceId = ((packageId & 0xff) << 24) | ((typeId & 0xff) << 16) | index;
    const entry = {
      resourceId,
      typeId,
      typeName,
      key: keyStrings?.get(keyIndex) || "",
      config,
      value: { type, data },
    };
    table.entryCount += 1;
    if (table.entryCount > MAX_RESOURCE_ENTRIES) {
      fail("invalid_apk", "resources.arsc có quá nhiều entry.");
    }
    const bucket = table.byId.get(resourceId);
    if (bucket) bucket.push(entry);
    else table.byId.set(resourceId, [entry]);
  }
}

/**
 * Parse the resource table. The returned object keeps every entry grouped by
 * resource id; resolution is lazy so a large table stays cheap.
 */
export function parseResTable(bytes, options = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) {
    fail("invalid_apk", "resources.arsc quá nhỏ.");
  }
  if (readU16(bytes, 0) !== RES_TABLE) {
    fail("invalid_apk", "resources.arsc không phải bảng tài nguyên.");
  }
  const headerSize = readU16(bytes, 2);
  const declaredSize = readU32(bytes, 4);
  if (headerSize == null || headerSize < 12) {
    fail("invalid_apk", "Header resources.arsc bị hỏng.");
  }
  const end = Math.min(bytes.length, declaredSize || bytes.length);
  const table = {
    packages: [],
    byId: new Map(),
    strings: null,
    entryCount: 0,
  };
  let cursor = headerSize;
  while (cursor + 8 <= end) {
    const type = readU16(bytes, cursor);
    const chunkHeader = readU16(bytes, cursor + 2);
    const chunkSize = readU32(bytes, cursor + 4);
    if (
      type == null ||
      chunkHeader == null ||
      chunkSize == null ||
      chunkSize < 8 ||
      cursor + chunkSize > end
    ) {
      fail("invalid_apk", "Chunk resources.arsc bị hỏng.");
    }
    if (type === AXML_STRING_POOL && !table.strings) {
      table.strings = parseStringPool(bytes, cursor, chunkHeader, chunkSize, {
        maxStrings: options.maxStrings ?? 1000000,
      });
    } else if (type === RES_TABLE_PACKAGE) {
      const parsed = parsePackage(bytes, cursor, chunkHeader, chunkSize, table);
      table.packages.push(parsed);
    }
    cursor += chunkSize;
  }
  if (!table.strings) fail("invalid_apk", "resources.arsc thiếu string pool.");
  return table;
}

/* ------------------------------------------------------------- resolution */

function pickEntry(entries, options) {
  if (!entries?.length) return null;
  return entries.slice().sort((left, right) => compareConfigs(left, right, options))[0];
}

function stringOfValue(table, value) {
  if (!value) return null;
  if (value.type === TYPE_STRING) return table.strings.get(value.data);
  return null;
}

/**
 * Resolve a resource id, following reference chains. The selected entry is the
 * default locale, then `en`, then the least-qualified config.
 */
export function resolveResource(table, resourceId, options = {}) {
  if (!table || !Number.isInteger(resourceId)) return null;
  let currentId = resourceId >>> 0;
  const seen = new Set();
  for (let depth = 0; depth <= MAX_REFERENCE_DEPTH; depth += 1) {
    const entries = table.byId.get(currentId);
    if (!entries?.length) return null;
    const picked = pickEntry(entries, options);
    if (!picked) return null;
    if (picked.value.type === TYPE_REFERENCE) {
      if (seen.has(picked.value.data)) return null;
      seen.add(picked.value.data);
      currentId = picked.value.data;
      continue;
    }
    const string = stringOfValue(table, picked.value);
    return {
      id: currentId,
      requestedId: resourceId >>> 0,
      value: picked.value,
      string,
      color: isColorType(picked.value.type) ? picked.value.data >>> 0 : null,
      config: picked.config,
      key: picked.key,
    };
  }
  return null;
}

export function resolveLabel(table, refOrValue) {
  if (refOrValue == null) return null;
  if (typeof refOrValue === "string") return refOrValue || null;
  if (typeof refOrValue === "number") {
    return resolveResource(table, refOrValue)?.string ?? null;
  }
  return null;
}

export function resolveVersionName(table, refOrValue) {
  return resolveLabel(table, refOrValue);
}

function isResourcePath(value) {
  if (typeof value !== "string") return false;
  return /\.(xml|png|webp|jpe?g)$/i.test(value);
}

function isXmlPath(value) {
  return /\.xml$/i.test(String(value || ""));
}

export function rasterContentType(entry) {
  const path = String(entry || "");
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.webp$/i.test(path)) return "image/webp";
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  return null;
}

function collectIconCandidates(table, resourceId, depth, seen, output, originalId) {
  if (depth > MAX_REFERENCE_DEPTH) return;
  const entries = table.byId.get(resourceId);
  if (!entries?.length) return;
  for (const entry of entries) {
    if (entry.value.type === TYPE_REFERENCE) {
      if (seen.has(entry.value.data)) continue;
      const nextSeen = new Set(seen);
      nextSeen.add(entry.value.data);
      collectIconCandidates(
        table,
        entry.value.data,
        depth + 1,
        nextSeen,
        output,
        originalId,
      );
      continue;
    }
    if (entry.value.type !== TYPE_STRING) continue;
    const path = table.strings.get(entry.value.data);
    if (!isResourcePath(path)) continue;
    output.push({
      resourceId: originalId,
      resolvedId: resourceId,
      entry: path,
      kind: isXmlPath(path) ? "xml" : "raster",
      density: entry.config.density || 0,
      config: entry.config,
      key: entry.key,
    });
  }
}

/**
 * Choose the launcher-icon drawable for a manifest reference.
 *
 * `prefer: "xml"` (dashboard) selects the adaptive/vector XML even when raster
 * densities exist. `prefer: "raster"` (server) selects the highest-density
 * raster and only falls back to XML when no raster is present.
 */
export function resolveIconResource(table, resourceId, { prefer = "xml" } = {}) {
  if (!table || !Number.isInteger(resourceId)) return null;
  const candidates = [];
  collectIconCandidates(table, resourceId >>> 0, 0, new Set(), candidates, resourceId >>> 0);
  if (!candidates.length) return null;
  const xml = candidates.filter((candidate) => candidate.kind === "xml");
  const raster = candidates.filter((candidate) => candidate.kind === "raster");

  if (prefer === "raster") {
    if (raster.length) {
      return raster
        .slice()
        .sort((left, right) => compareConfigs(left, right, { preferDensity: true }))[0];
    }
    if (xml.length) {
      return xml
        .slice()
        .sort((left, right) => compareConfigs(left, right))[0];
    }
    return candidates[0];
  }

  if (xml.length) {
    return xml.slice().sort((left, right) => compareConfigs(left, right))[0];
  }
  return raster
    .slice()
    .sort((left, right) => compareConfigs(left, right, { preferDensity: true }))[0];
}

/**
 * Synchronous descriptor helper for tests and callers that already know how to
 * classify XML entries. `xmlKind(entry)` must return "adaptive" or "vector".
 */
export function resolveIconDescriptor(table, resourceId, { prefer = "xml", xmlKind } = {}) {
  const resource = resolveIconResource(table, resourceId, { prefer });
  if (!resource) return null;
  if (resource.kind === "xml") {
    const kind = xmlKind ? xmlKind(resource.entry) : null;
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
}

/* -------------------------------------------------------------- binary XML */

function parseStartElement(bytes, start, chunkSize, pool, namespaces, resourceMap) {
  if (chunkSize < 16 + 20) return null;
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
    fail("invalid_apk", "Start element XML bị hỏng.");
  }
  const stride = attributeSize >= 20 ? attributeSize : 20;
  const attributesBase = start + 16 + (attributeStart || 20);
  const chunkEnd = start + chunkSize;
  const attrList = [];
  const attrs = new Map();
  for (let index = 0; index < attributeCount; index += 1) {
    const offset = attributesBase + index * stride;
    if (offset + 20 > chunkEnd) break;
    const nsIndex = readU32(bytes, offset);
    const localNameIndex = readU32(bytes, offset + 4);
    const rawIndex = readU32(bytes, offset + 8);
    const dataType = bytes[offset + 15];
    const data = readU32(bytes, offset + 16);
    if (localNameIndex == null || data == null || dataType == null) {
      fail("invalid_apk", "Attribute XML bị hỏng.");
    }
    const name = pool.get(localNameIndex) || "";
    const ns =
      nsIndex == null || nsIndex === 0xffffffff
        ? null
        : namespaces.get(nsIndex) ?? pool.get(nsIndex) ?? null;
    const raw = rawIndex === 0xffffffff || rawIndex == null ? null : pool.get(rawIndex);
    const string = dataType === TYPE_STRING ? pool.get(data) : null;
    let value = raw;
    if (dataType === TYPE_STRING) value = string;
    else if (dataType === TYPE_REFERENCE) value = data >>> 0;
    else if (dataType === TYPE_INT_BOOLEAN) value = data !== 0;
    else if (dataType === TYPE_INT_DEC) value = data | 0;
    else if (dataType === TYPE_INT_HEX || isColorType(dataType)) value = data >>> 0;
    else if (dataType === TYPE_FLOAT) value = readF32(bytes, offset + 16);
    const attr = {
      name,
      ns,
      raw,
      type: dataType,
      data: data >>> 0,
      string,
      value,
      resourceId: resourceMap.get(localNameIndex) ?? null,
    };
    attrList.push(attr);
    if (!attrs.has(name)) attrs.set(name, attr);
  }
  return {
    name: pool.get(nameIndex) || "",
    ns: null,
    attrs,
    attrList,
    children: [],
    text: "",
  };
}

/**
 * Parse Android binary XML into a light element tree. Unknown chunks are
 * skipped; malformed chunks fail loudly so callers can fall back.
 */
export function parseBinaryXml(bytes, options = {}) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 8) {
    fail("invalid_apk", "XML nhị phân quá nhỏ.");
  }
  if (readU16(bytes, 0) !== AXML_FILE) {
    fail("invalid_apk", "Tệp không phải binary XML.");
  }
  const headerSize = readU16(bytes, 2);
  if (headerSize == null || headerSize < 8) {
    fail("invalid_apk", "Header binary XML bị hỏng.");
  }

  let pool = null;
  let resourceMap = new Map();
  let cursor = headerSize;
  while (cursor + 8 <= bytes.length) {
    const type = readU16(bytes, cursor);
    const childHeader = readU16(bytes, cursor + 2);
    const chunkSize = readU32(bytes, cursor + 4);
    if (
      type == null ||
      childHeader == null ||
      chunkSize == null ||
      chunkSize < 8 ||
      cursor + chunkSize > bytes.length
    ) {
      fail("invalid_apk", "Chunk binary XML bị hỏng.");
    }
    if (type === AXML_STRING_POOL) {
      pool = parseStringPool(bytes, cursor, childHeader, chunkSize, {
        maxStrings: options.maxStrings ?? 1000000,
      });
    } else if (type === AXML_RESOURCE_MAP) {
      const count = Math.floor((chunkSize - childHeader) / 4);
      const map = new Map();
      for (let index = 0; index < count; index += 1) {
        const id = readU32(bytes, cursor + childHeader + index * 4);
        if (id != null) map.set(index, id);
      }
      resourceMap = map;
    }
    cursor += chunkSize;
  }
  if (!pool) fail("invalid_apk", "Binary XML thiếu string pool.");

  const namespaces = new Map();
  const stack = [];
  let root = null;
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
      fail("invalid_apk", "Chunk binary XML bị hỏng.");
    }
    if (type === AXML_START_NAMESPACE) {
      const prefix = pool.get(readU32(bytes, cursor + 16));
      const uri = pool.get(readU32(bytes, cursor + 20));
      if (prefix != null && uri != null) namespaces.set(prefix, uri);
    } else if (type === AXML_START_ELEMENT) {
      const element = parseStartElement(
        bytes,
        cursor,
        chunkSize,
        pool,
        namespaces,
        resourceMap,
      );
      if (element) {
        if (stack.length) stack[stack.length - 1].children.push(element);
        else if (!root) root = element;
        stack.push(element);
        if (stack.length > 256) fail("invalid_apk", "Cây XML quá sâu.");
      }
    } else if (type === AXML_END_ELEMENT) {
      stack.pop();
    } else if (type === AXML_CDATA && stack.length) {
      const text = pool.get(readU32(bytes, cursor + 16));
      if (text != null) stack[stack.length - 1].text += text;
    }
    cursor += chunkSize;
  }
  if (!root) fail("invalid_apk", "Binary XML không có phần tử gốc.");
  return root;
}

export function attrOf(node, name) {
  return node?.attrs?.get(name) || null;
}

export function iconKindFromElement(element) {
  if (element?.name === "adaptive-icon") return "adaptive";
  if (element?.name === "vector") return "vector";
  return null;
}

/* --------------------------------------------------------------- helpers */

export function describeLoadingError(error) {
  if (error instanceof ApkInspectError) return error.message;
  return error?.message || "Không đọc được tài nguyên APK.";
}
