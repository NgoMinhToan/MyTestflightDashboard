/**
 * Read the identity of an APK without uploading it.
 *
 * Pure ESM with no DOM or Node dependencies beyond the platform globals, so
 * the same module powers the browser preview and the `node --test` suite:
 *   - the ZIP end-of-central-directory is located inside the last 65 557 bytes
 *   - the central directory supplies sizes/offsets (data descriptors are fine)
 *   - only `AndroidManifest.xml` is inflated (stored or deflate-raw)
 *   - the binary AXML string pool and start elements are parsed
 *
 * Deliberately defensive: every malformed structure becomes a typed
 * ApkInspectError instead of an unbounded read or a silent wrong answer.
 */

export const APK_ABI_ORDER = [
  "arm64-v8a",
  "armeabi-v7a",
  "x86_64",
  "x86",
  "riscv64",
  "armeabi",
];

const ABI_SET = new Set(APK_ABI_ORDER);

const EOCD_SIGNATURE = 0x06054b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

const EOCD_SEARCH_BYTES = 65557; // 22-byte EOCD + 65 535-byte maximum comment
const MAX_CENTRAL_DIRECTORY = 64 * 1024 * 1024;
const MAX_ENTRIES = 200000;
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

export class ApkInspectError extends Error {
  /**
   * @param {"invalid_apk" | "zip64" | "config_split" | "preview_unavailable"} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "ApkInspectError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ApkInspectError(code, message);
}

/* ------------------------------------------------------------------ bytes */

function readU16(bytes, offset) {
  if (offset < 0 || offset + 2 > bytes.length) return null;
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readU32(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function decodeUtf8Length(bytes, offset) {
  if (offset < 0 || offset >= bytes.length) return null;
  let value = bytes[offset];
  let cursor = offset + 1;
  if (value & 0x80) {
    if (cursor >= bytes.length) return null;
    value = ((value & 0x7f) << 8) | bytes[cursor];
    cursor += 1;
  }
  return { value, next: cursor };
}

function decodeUtf16Length(bytes, offset) {
  const first = readU16(bytes, offset);
  if (first == null) return null;
  let value = first;
  let cursor = offset + 2;
  if (value & 0x8000) {
    const second = readU16(bytes, cursor);
    if (second == null) return null;
    value = ((value & 0x7fff) << 16) | second;
    cursor += 2;
  }
  return { value, next: cursor };
}

function isArrayBufferValue(source) {
  return Object.prototype.toString.call(source) === "[object ArrayBuffer]";
}

async function openSource(source) {
  if (source == null) fail("invalid_apk", "Không có tệp APK để đọc.");
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    return {
      size: source.size,
      read: async (offset, length) =>
        new Uint8Array(await source.slice(offset, offset + length).arrayBuffer()),
    };
  }
  if (isArrayBufferValue(source)) {
    const bytes = new Uint8Array(source);
    return {
      size: bytes.byteLength,
      read: async (offset, length) => bytes.subarray(offset, offset + length),
    };
  }
  if (ArrayBuffer.isView(source)) {
    const bytes = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    return {
      size: bytes.byteLength,
      read: async (offset, length) => bytes.subarray(offset, offset + length),
    };
  }
  fail("invalid_apk", "Nguồn APK không hợp lệ.");
  return null;
}

async function readRange(source, offset, length) {
  if (
    !Number.isInteger(offset) ||
    !Number.isInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset + length > source.size
  ) {
    fail("invalid_apk", "Tệp APK bị cắt cụt hoặc hỏng.");
  }
  if (length === 0) return new Uint8Array(0);
  return source.read(offset, length);
}

/* ------------------------------------------------------------------- EOCD */

async function findEndOfCentralDirectory(source) {
  if (source.size < 22) fail("invalid_apk", "Tệp quá nhỏ để là APK.");
  const tailLength = Math.min(source.size, EOCD_SEARCH_BYTES);
  const tailStart = source.size - tailLength;
  const tail = await readRange(source, tailStart, tailLength);

  let fallback = -1;
  for (let index = tailLength - 22; index >= 0; index -= 1) {
    if (readU32(tail, index) !== EOCD_SIGNATURE) continue;
    const commentLength = readU16(tail, index + 20);
    if (commentLength == null) continue;
    if (fallback < 0) fallback = index;
    // A well-formed EOCD comment runs to the end of the file.
    if (index + 22 + commentLength === tailLength) return { tail, index };
  }
  if (fallback >= 0) return { tail, index: fallback };
  fail("invalid_apk", "Không tìm thấy EOCD; tệp không phải ZIP/APK.");
  return null;
}

function parseEndOfCentralDirectory(tail, index) {
  if (index >= 20 && readU32(tail, index - 20) === ZIP64_LOCATOR_SIGNATURE) {
    fail("zip64", "APK dùng ZIP64; chưa hỗ trợ xem trước.");
  }
  const diskNumber = readU16(tail, index + 4);
  const centralDisk = readU16(tail, index + 6);
  const entriesOnDisk = readU16(tail, index + 8);
  const entries = readU16(tail, index + 10);
  const directorySize = readU32(tail, index + 12);
  const directoryOffset = readU32(tail, index + 16);
  if (
    diskNumber == null ||
    centralDisk == null ||
    entriesOnDisk == null ||
    entries == null ||
    directorySize == null ||
    directoryOffset == null
  ) {
    fail("invalid_apk", "EOCD bị hỏng.");
  }
  if (diskNumber !== 0 || centralDisk !== 0) {
    fail("invalid_apk", "APK nhiều đĩa không được hỗ trợ.");
  }
  if (
    entriesOnDisk === 0xffff ||
    entries === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  ) {
    fail("zip64", "APK dùng ZIP64; chưa hỗ trợ xem trước.");
  }
  if (entries > MAX_ENTRIES) {
    fail("invalid_apk", "APK có quá nhiều mục ZIP.");
  }
  if (directorySize > MAX_CENTRAL_DIRECTORY) {
    fail("invalid_apk", "Central directory của APK quá lớn.");
  }
  return { entries, directorySize, directoryOffset };
}

/* -------------------------------------------------------- central directory */

async function readCentralDirectory(source, offset, size, expectedEntries) {
  const bytes = await readRange(source, offset, size);
  const entries = [];
  let cursor = 0;
  while (cursor + 4 <= bytes.length) {
    if (readU32(bytes, cursor) !== CENTRAL_SIGNATURE) break;
    if (cursor + 46 > bytes.length) fail("invalid_apk", "Central directory bị hỏng.");
    const flags = readU16(bytes, cursor + 8);
    const method = readU16(bytes, cursor + 10);
    const compressedSize = readU32(bytes, cursor + 20);
    const uncompressedSize = readU32(bytes, cursor + 24);
    const nameLength = readU16(bytes, cursor + 28);
    const extraLength = readU16(bytes, cursor + 30);
    const commentLength = readU16(bytes, cursor + 32);
    const diskStart = readU16(bytes, cursor + 34);
    const localOffset = readU32(bytes, cursor + 42);
    if (
      flags == null ||
      method == null ||
      compressedSize == null ||
      uncompressedSize == null ||
      nameLength == null ||
      extraLength == null ||
      commentLength == null ||
      diskStart == null ||
      localOffset == null
    ) {
      fail("invalid_apk", "Central directory bị hỏng.");
    }
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff ||
      diskStart === 0xffff
    ) {
      fail("zip64", "APK dùng ZIP64; chưa hỗ trợ xem trước.");
    }
    const recordLength = 46 + nameLength + extraLength + commentLength;
    if (cursor + recordLength > bytes.length) {
      fail("invalid_apk", "Central directory bị hỏng.");
    }
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = new TextDecoder("utf-8").decode(nameBytes);
    entries.push({
      name,
      method,
      flags,
      compressedSize,
      uncompressedSize,
      localOffset,
    });
    cursor += recordLength;
    if (entries.length > MAX_ENTRIES) fail("invalid_apk", "APK có quá nhiều mục ZIP.");
  }
  if (entries.length !== expectedEntries) {
    fail("invalid_apk", "Central directory không khớp EOCD.");
  }
  return entries;
}

function collectAbis(entries) {
  const seen = new Set();
  for (const entry of entries) {
    const match = /^lib\/([^/]+)\//.exec(entry.name);
    if (match && ABI_SET.has(match[1])) seen.add(match[1]);
  }
  return APK_ABI_ORDER.filter((abi) => seen.has(abi));
}

/* --------------------------------------------------------------- manifest */

async function readEntryBytes(source, entry) {
  if (entry.compressedSize > MAX_COMPRESSED_MANIFEST) {
    fail("invalid_apk", "AndroidManifest.xml nén vượt 16 MiB.");
  }
  if (entry.uncompressedSize > MAX_INFLATED_MANIFEST) {
    fail("invalid_apk", "AndroidManifest.xml sau giải nén vượt 8 MiB.");
  }
  const header = await readRange(source, entry.localOffset, 30);
  if (readU32(header, 0) !== LOCAL_SIGNATURE) {
    fail("invalid_apk", "Local header của AndroidManifest.xml bị hỏng.");
  }
  const nameLength = readU16(header, 26);
  const extraLength = readU16(header, 28);
  if (nameLength == null || extraLength == null) {
    fail("invalid_apk", "Local header của AndroidManifest.xml bị hỏng.");
  }
  const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
  const raw = await readRange(source, dataOffset, entry.compressedSize);

  if (entry.method === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) {
      fail("invalid_apk", "AndroidManifest.xml lưu trữ với kích thước sai.");
    }
    if (raw.length > MAX_INFLATED_MANIFEST) {
      fail("invalid_apk", "AndroidManifest.xml sau giải nén vượt 8 MiB.");
    }
    return raw;
  }
  if (entry.method !== 8) {
    fail("invalid_apk", "AndroidManifest.xml dùng phương thức nén không hỗ trợ.");
  }
  if (typeof DecompressionStream === "undefined") {
    fail(
      "preview_unavailable",
      "Trình duyệt không hỗ trợ DecompressionStream; không xem trước được APK.",
    );
  }
  const inflated = await inflateRaw(raw);
  if (inflated.length !== entry.uncompressedSize) {
    fail("invalid_apk", "AndroidManifest.xml giải nén không khớp kích thước.");
  }
  return inflated;
}

async function inflateRaw(bytes) {
  let stream;
  try {
    stream = new DecompressionStream("deflate-raw");
  } catch {
    fail(
      "preview_unavailable",
      "Trình duyệt không hỗ trợ deflate-raw; không xem trước được APK.",
    );
  }
  let source;
  if (typeof ReadableStream !== "undefined") {
    source = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  } else {
    source = new Blob([bytes]).stream();
  }
  let reader;
  try {
    reader = source.pipeThrough(stream).getReader();
  } catch {
    fail("invalid_apk", "AndroidManifest.xml bị hỏng.");
  }
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_INFLATED_MANIFEST) {
        await reader.cancel().catch(() => {});
        fail("invalid_apk", "AndroidManifest.xml sau giải nén vượt 8 MiB.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ApkInspectError) throw error;
    if (error instanceof RangeError) {
      fail("invalid_apk", "AndroidManifest.xml sau giải nén vượt 8 MiB.");
    }
    fail("invalid_apk", "AndroidManifest.xml bị hỏng hoặc nén không hợp lệ.");
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/* ------------------------------------------------------------------- AXML */

function parseStringPool(bytes, start, headerSize, chunkSize) {
  if (headerSize < 28) fail("invalid_apk", "String pool AXML bị hỏng.");
  const stringCount = readU32(bytes, start + 8);
  const styleCount = readU32(bytes, start + 12);
  const flags = readU32(bytes, start + 16);
  const stringsStart = readU32(bytes, start + 20);
  if (
    stringCount == null ||
    styleCount == null ||
    flags == null ||
    stringsStart == null
  ) {
    fail("invalid_apk", "String pool AXML bị hỏng.");
  }
  if (stringCount > 1000000) fail("invalid_apk", "String pool AXML quá lớn.");
  const chunkEnd = start + chunkSize;
  const offsetsStart = start + headerSize;
  if (offsetsStart + stringCount * 4 + styleCount * 4 > chunkEnd) {
    fail("invalid_apk", "String pool AXML bị hỏng.");
  }
  const stringsBase = start + stringsStart;
  if (stringsBase < start || stringsBase > chunkEnd) {
    fail("invalid_apk", "String pool AXML bị hỏng.");
  }
  const utf8 = (flags & 0x100) !== 0;
  const utf8Decoder = new TextDecoder("utf-8");
  const utf16Decoder = new TextDecoder("utf-16le");
  const cache = new Map();

  function get(index) {
    if (index == null || index < 0 || index >= stringCount) return null;
    if (cache.has(index)) return cache.get(index);
    const relative = readU32(bytes, offsetsStart + index * 4);
    if (relative == null || relative === 0xffffffff) {
      cache.set(index, null);
      return null;
    }
    let cursor = stringsBase + relative;
    if (cursor < stringsBase || cursor >= chunkEnd) {
      fail("invalid_apk", "String pool AXML bị hỏng.");
    }
    let text;
    if (utf8) {
      const charLength = decodeUtf8Length(bytes, cursor);
      if (!charLength) fail("invalid_apk", "String pool AXML bị hỏng.");
      cursor = charLength.next;
      const byteLength = decodeUtf8Length(bytes, cursor);
      if (!byteLength) fail("invalid_apk", "String pool AXML bị hỏng.");
      cursor = byteLength.next;
      if (cursor + byteLength.value > chunkEnd) {
        fail("invalid_apk", "String pool AXML bị hỏng.");
      }
      text = utf8Decoder.decode(bytes.subarray(cursor, cursor + byteLength.value));
    } else {
      const charLength = decodeUtf16Length(bytes, cursor);
      if (!charLength) fail("invalid_apk", "String pool AXML bị hỏng.");
      cursor = charLength.next;
      const byteLength = charLength.value * 2;
      if (cursor + byteLength > chunkEnd) {
        fail("invalid_apk", "String pool AXML bị hỏng.");
      }
      text = utf16Decoder.decode(bytes.subarray(cursor, cursor + byteLength));
    }
    cache.set(index, text);
    return text;
  }

  return { get };
}

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
      data,
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
  const versionName = stringOf(attributeOf(manifestAttributes, "versionName"));
  const split = stringOf(attributeOf(manifestAttributes, "split"));
  const configForSplit = attributeOf(manifestAttributes, "configForSplit");
  const minSdk = intOf(attributeOf(usesSdkAttributes, "minSdkVersion"));
  const targetSdk = intOf(attributeOf(usesSdkAttributes, "targetSdkVersion"));

  return {
    packageName,
    versionCode,
    // An empty android:versionName behaves like a missing one.
    versionName: versionName ? versionName : null,
    minSdk: Number.isInteger(minSdk) ? minSdk : null,
    targetSdk: Number.isInteger(targetSdk) ? targetSdk : null,
    debuggable: boolOf(attributeOf(applicationAttributes, "debuggable")),
    testOnly: boolOf(attributeOf(applicationAttributes, "testOnly")),
    split: split || null,
    configSplit: Boolean(split && split.startsWith("config.")) || Boolean(configForSplit),
  };
}

/* ------------------------------------------------------------------- API */

/**
 * @param {File | Blob | Uint8Array | ArrayBuffer | DataView} source
 * @returns {Promise<{
 *   packageName: string,
 *   versionCode: number,
 *   versionName: string | null,
 *   minSdk: number | null,
 *   targetSdk: number | null,
 *   abis: string[],
 *   universal: boolean,
 *   debuggable: boolean,
 *   testOnly: boolean,
 *   split: string | null,
 *   configSplit: boolean,
 *   artifactAbi: string,
 * }>}
 */
export async function inspectApk(source) {
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
  const manifest = archiveEntries.find((entry) => entry.name === "AndroidManifest.xml");
  if (!manifest) fail("invalid_apk", "APK thiếu AndroidManifest.xml.");
  const abis = collectAbis(archiveEntries);
  const metadata = parseAxml(await readEntryBytes(reader, manifest));
  const universal = abis.length !== 1;
  return {
    ...metadata,
    abis,
    universal,
    artifactAbi: universal ? "universal" : abis[0],
  };
}

export function artifactAbiOf(metadata) {
  const abis = Array.isArray(metadata?.abis) ? metadata.abis : [];
  return abis.length === 1 ? abis[0] : "universal";
}
