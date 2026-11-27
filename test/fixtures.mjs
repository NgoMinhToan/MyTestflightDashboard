/**
 * Test fixtures: a tiny ZIP writer and a binary-AXML (Android resource XML)
 * builder. Both are intentionally dependency-free apart from `node:zlib`, so
 * the parser can be exercised against stored/deflated, UTF-8/UTF-16 and
 * malformed variants without committing an APK.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The shared real fixture: an 8 000-byte AndroidManifest.xml from the workspace APK. */
export const REAL_MANIFEST_AXML = Uint8Array.from(
  Buffer.from(readFileSync(join(HERE, "manifest.axml.b64"), "utf8").trim(), "base64"),
);

export const REAL_MANIFEST_EXPECTED = {
  packageName: "dev.minhtoan.mytestflight",
  versionCode: 18,
  versionName: "0.2.0",
  minSdk: 26,
  targetSdk: 37,
  artifactAbi: "arm64-v8a",
};

/* ------------------------------------------------------------------- CRC32 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* --------------------------------------------------------------------- ZIP */

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string") return Buffer.from(value, "utf8");
  return Buffer.from(value);
}

/**
 * Build a ZIP archive.
 * Entry: { name, data, method = 0|8, dataDescriptor = false }
 */
export function buildZip(entries, { comment = "" } = {}) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = asBuffer(entry.data);
    const method = entry.method ?? 0;
    if (method !== 0 && method !== 8) {
      throw new Error(`unsupported test method ${method}`);
    }
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const checksum = crc32(data);
    const useDescriptor = Boolean(entry.dataDescriptor);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(useDescriptor ? 0x0008 : 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(useDescriptor ? 0 : checksum, 14);
    local.writeUInt32LE(useDescriptor ? 0 : compressed.length, 18);
    local.writeUInt32LE(useDescriptor ? 0 : data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    let descriptor = Buffer.alloc(0);
    if (useDescriptor) {
      descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(checksum, 4);
      descriptor.writeUInt32LE(compressed.length, 8);
      descriptor.writeUInt32LE(data.length, 12);
    }

    localParts.push(local, name, compressed, descriptor);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(useDescriptor ? 0x0008 : 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + compressed.length + descriptor.length;
  }

  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const commentBytes = Buffer.from(comment, "utf8");
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(commentBytes.length, 20);

  return Uint8Array.from(
    Buffer.concat([...localParts, central, eocd, commentBytes]),
  );
}

function findEocdIndex(bytes) {
  for (let index = bytes.length - 22; index >= 0; index -= 1) {
    if (bytes.readUInt32LE(index) === 0x06054b50) return index;
  }
  throw new Error("EOCD not found");
}

/** Patch EOCD counters/sizes to exercise ZIP64 sentinels and caps. */
export function patchEocd(bytes, patch = {}) {
  const output = Buffer.from(bytes);
  const index = findEocdIndex(output);
  if (patch.entriesOnDisk != null) output.writeUInt16LE(patch.entriesOnDisk, index + 8);
  if (patch.entries != null) output.writeUInt16LE(patch.entries, index + 10);
  if (patch.directorySize != null) output.writeUInt32LE(patch.directorySize, index + 12);
  if (patch.directoryOffset != null) output.writeUInt32LE(patch.directoryOffset, index + 16);
  return Uint8Array.from(output);
}

/** Patch one central-directory record by entry name. */
export function patchCentralEntry(bytes, name, patch = {}) {
  const output = Buffer.from(bytes);
  const eocd = findEocdIndex(output);
  const directoryOffset = output.readUInt32LE(eocd + 16);
  const total = output.readUInt16LE(eocd + 10);
  let cursor = directoryOffset;
  for (let index = 0; index < total; index += 1) {
    if (output.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("central directory corrupt");
    }
    const nameLength = output.readUInt16LE(cursor + 28);
    const extraLength = output.readUInt16LE(cursor + 30);
    const commentLength = output.readUInt16LE(cursor + 32);
    const current = output.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (current === name) {
      if (patch.method != null) output.writeUInt16LE(patch.method, cursor + 10);
      if (patch.compressedSize != null) {
        output.writeUInt32LE(patch.compressedSize, cursor + 20);
      }
      if (patch.uncompressedSize != null) {
        output.writeUInt32LE(patch.uncompressedSize, cursor + 24);
      }
      if (patch.localOffset != null) output.writeUInt32LE(patch.localOffset, cursor + 42);
      return Uint8Array.from(output);
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`central entry not found: ${name}`);
}

/** Insert a ZIP64 end-of-central-directory locator before the EOCD. */
export function withZip64Locator(bytes) {
  const output = Buffer.from(bytes);
  const eocd = findEocdIndex(output);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  return Uint8Array.from(
    Buffer.concat([output.subarray(0, eocd), locator, output.subarray(eocd)]),
  );
}

/* -------------------------------------------------------------------- AXML */

const ATTR_TYPES = {
  string: 0x03,
  int: 0x10,
  hex: 0x11,
  bool: 0x12,
  ref: 0x01,
};

function encodeUtf8Length(value) {
  if (value < 0x80) return Buffer.from([value]);
  return Buffer.from([0x80 | ((value >> 8) & 0x7f), value & 0xff]);
}

function encodeUtf8String(text) {
  const data = Buffer.from(text, "utf8");
  return Buffer.concat([
    encodeUtf8Length(text.length),
    encodeUtf8Length(data.length),
    data,
    Buffer.from([0]),
  ]);
}

function encodeUtf16Length(value) {
  const buffer = Buffer.alloc(value <= 0x7fff ? 2 : 4);
  if (value <= 0x7fff) {
    buffer.writeUInt16LE(value, 0);
  } else {
    buffer.writeUInt16LE(0x8000 | ((value >> 16) & 0x7fff), 0);
    buffer.writeUInt16LE(value & 0xffff, 2);
  }
  return buffer;
}

function encodeUtf16String(text) {
  const data = Buffer.from(text, "utf16le");
  return Buffer.concat([encodeUtf16Length(text.length), data, Buffer.from([0, 0])]);
}

function buildStringPool(strings, utf8) {
  const encoded = strings.map((text) =>
    utf8 ? encodeUtf8String(text) : encodeUtf16String(text),
  );
  const headerSize = 28;
  const stringsStart = headerSize + strings.length * 4;
  const dataSize = encoded.reduce((sum, item) => sum + item.length, 0);
  const chunkSize = (stringsStart + dataSize + 3) & ~3;
  const output = Buffer.alloc(chunkSize);
  output.writeUInt16LE(0x0001, 0);
  output.writeUInt16LE(headerSize, 2);
  output.writeUInt32LE(chunkSize, 4);
  output.writeUInt32LE(strings.length, 8);
  output.writeUInt32LE(0, 12);
  output.writeUInt32LE(utf8 ? 0x100 : 0, 16);
  output.writeUInt32LE(stringsStart, 20);
  output.writeUInt32LE(0, 24);
  let dataOffset = 0;
  encoded.forEach((data, index) => {
    output.writeUInt32LE(dataOffset, headerSize + index * 4);
    data.copy(output, stringsStart + dataOffset);
    dataOffset += data.length;
  });
  return output;
}

function collectStrings(elements) {
  const seen = new Set();
  const add = (value) => {
    if (value != null) seen.add(String(value));
  };
  for (const element of elements) {
    add(element.name);
    for (const attribute of element.attrs || []) {
      add(attribute.name);
      const type = attribute.type || "string";
      if (type === "string") add(attribute.value);
      if (typeof attribute.raw === "string") add(attribute.raw);
    }
  }
  return [...seen];
}

function buildStartElement(element, indexOf) {
  const attrs = element.attrs || [];
  const chunkSize = 16 + 20 + attrs.length * 20;
  const output = Buffer.alloc(chunkSize);
  output.writeUInt16LE(0x0102, 0);
  output.writeUInt16LE(16, 2);
  output.writeUInt32LE(chunkSize, 4);
  output.writeUInt32LE(1, 8);
  output.writeUInt32LE(0xffffffff, 12);
  const ext = 16;
  output.writeUInt32LE(0xffffffff, ext);
  output.writeUInt32LE(indexOf(element.name), ext + 4);
  output.writeUInt16LE(20, ext + 8);
  output.writeUInt16LE(20, ext + 10);
  output.writeUInt16LE(attrs.length, ext + 12);
  output.writeUInt16LE(0, ext + 14);
  output.writeUInt16LE(0, ext + 16);
  output.writeUInt16LE(0, ext + 18);

  attrs.forEach((attribute, index) => {
    const type = attribute.type || "string";
    const dataType = ATTR_TYPES[type];
    if (dataType == null) throw new Error(`unknown attr type ${type}`);
    const offset = ext + 20 + index * 20;
    output.writeUInt32LE(0xffffffff, offset);
    output.writeUInt32LE(indexOf(attribute.name), offset + 4);
    let raw = 0xffffffff;
    if (attribute.raw === null) raw = 0xffffffff;
    else if (typeof attribute.raw === "string") raw = indexOf(attribute.raw);
    else if (type === "string") raw = indexOf(attribute.value);
    output.writeUInt32LE(raw, offset + 8);
    output.writeUInt16LE(8, offset + 12);
    output.writeUInt8(0, offset + 14);
    output.writeUInt8(dataType, offset + 15);
    let data = 0;
    if (dataType === 0x03) data = indexOf(attribute.value);
    else if (dataType === 0x12) data = attribute.value ? 1 : 0;
    else if (dataType === 0x01) data = 0;
    else data = Number(attribute.value) | 0;
    output.writeUInt32LE(data >>> 0, offset + 16);
  });
  return output;
}

/** Build a binary XML document from a declarative element list. */
export function buildAxml({ utf8 = true, elements = [] } = {}) {
  const strings = collectStrings(elements);
  const indexOf = (value) => {
    const index = strings.indexOf(String(value));
    if (index < 0) throw new Error(`string not collected: ${value}`);
    return index;
  };
  const pool = buildStringPool(strings, utf8);
  const chunks = elements.map((element) => buildStartElement(element, indexOf));
  const body = Buffer.concat([pool, ...chunks]);
  const header = Buffer.alloc(8);
  header.writeUInt16LE(0x0003, 0);
  header.writeUInt16LE(8, 2);
  header.writeUInt32LE(8 + body.length, 4);
  return Uint8Array.from(Buffer.concat([header, body]));
}

/**
 * Build a manifest with the usual Android elements.
 * `versionNameRef` emits android:versionName as a resource reference.
 */
export function buildManifest(options = {}) {
  const {
    packageName = "com.example.fixture",
    versionCode = 7,
    versionName = "1.2.3",
    versionNameRef = false,
    minSdk = 26,
    minSdkCodename = null,
    targetSdk = 35,
    debuggable = false,
    testOnly = false,
    split = null,
    configForSplit = null,
    utf8 = true,
  } = options;

  const manifestAttributes = [
    { name: "package", type: "string", value: packageName },
    { name: "versionCode", type: "int", value: versionCode },
  ];
  if (versionNameRef) {
    manifestAttributes.push({ name: "versionName", type: "ref", value: 0 });
  } else if (versionName != null) {
    manifestAttributes.push({ name: "versionName", type: "string", value: versionName });
  }
  if (split != null) manifestAttributes.push({ name: "split", type: "string", value: split });
  if (configForSplit != null) {
    manifestAttributes.push({
      name: "configForSplit",
      type: "string",
      value: configForSplit,
    });
  }

  const elements = [{ name: "manifest", attrs: manifestAttributes }];
  const sdkAttributes = [];
  if (minSdkCodename != null) {
    sdkAttributes.push({ name: "minSdkVersion", type: "string", value: minSdkCodename });
  } else if (minSdk != null) {
    sdkAttributes.push({ name: "minSdkVersion", type: "int", value: minSdk });
  }
  if (targetSdk != null) {
    sdkAttributes.push({ name: "targetSdkVersion", type: "int", value: targetSdk });
  }
  if (sdkAttributes.length) elements.push({ name: "uses-sdk", attrs: sdkAttributes });

  const applicationAttributes = [];
  if (debuggable) {
    applicationAttributes.push({ name: "debuggable", type: "bool", value: true });
  }
  if (testOnly) {
    applicationAttributes.push({ name: "testOnly", type: "bool", value: true });
  }
  if (applicationAttributes.length) {
    elements.push({ name: "application", attrs: applicationAttributes });
  }
  return buildAxml({ utf8, elements });
}

/** Wrap a manifest in a minimal APK with optional `lib/<abi>/` entries. */
export function makeApk({
  manifest,
  abis = [],
  manifestMethod = 8,
  manifestDataDescriptor = false,
  extras = [],
} = {}) {
  const entries = [
    {
      name: "AndroidManifest.xml",
      data: manifest,
      method: manifestMethod,
      dataDescriptor: manifestDataDescriptor,
    },
  ];
  for (const abi of abis) {
    entries.push({
      name: `lib/${abi}/libfixture.so`,
      data: Buffer.from(`fixture-${abi}`),
      method: 0,
    });
  }
  entries.push({ name: "classes.dex", data: Buffer.from("dex\n035\0"), method: 8 });
  for (const extra of extras) entries.push(extra);
  return buildZip(entries);
}

/** Wrap the shared real manifest in an arm64 APK, as in the workspace build. */
export function realApk() {
  return makeApk({
    manifest: REAL_MANIFEST_AXML,
    abis: ["arm64-v8a"],
    manifestMethod: 0,
  });
}
