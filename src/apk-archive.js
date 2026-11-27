/**
 * ZIP/range/string-pool primitives shared by the APK inspector and the
 * `resources.arsc` / binary-XML readers.
 *
 * Pure ESM with no DOM or Node dependencies beyond platform globals, so the
 * same module powers the browser preview and the `node --test` suite:
 *   - the ZIP end-of-central-directory is located inside the last 65 557 bytes
 *   - the central directory supplies sizes/offsets (data descriptors are fine)
 *   - entries are inflated only when requested (stored or deflate-raw)
 *   - the Android string-pool chunk is decoded for both AXML and ARSC
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
export const MAX_CENTRAL_DIRECTORY = 64 * 1024 * 1024;
export const MAX_ENTRIES = 200000;
export const MAX_STRING_POOL_STRINGS = 1000000;

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

export function fail(code, message) {
  throw new ApkInspectError(code, message);
}

/* ------------------------------------------------------------------ bytes */

export function readU16(bytes, offset) {
  if (offset < 0 || !bytes || offset + 2 > bytes.length) return null;
  return bytes[offset] | (bytes[offset + 1] << 8);
}

export function readU32(bytes, offset) {
  if (offset < 0 || !bytes || offset + 4 > bytes.length) return null;
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

export function readS32(bytes, offset) {
  const value = readU32(bytes, offset);
  return value == null ? null : value | 0;
}

export function readF32(bytes, offset) {
  if (offset < 0 || !bytes || offset + 4 > bytes.length) return null;
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getFloat32(0, true);
}

export function decodeUtf8Length(bytes, offset) {
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

export function decodeUtf16Length(bytes, offset) {
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

export async function openSource(source) {
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

export async function readRange(source, offset, length) {
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

export async function findEndOfCentralDirectory(source) {
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

export function parseEndOfCentralDirectory(tail, index) {
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

export async function readCentralDirectory(source, offset, size, expectedEntries) {
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

export function collectAbis(entries) {
  const seen = new Set();
  for (const entry of entries) {
    const match = /^lib\/([^/]+)\//.exec(entry.name);
    if (match && ABI_SET.has(match[1])) seen.add(match[1]);
  }
  return APK_ABI_ORDER.filter((abi) => seen.has(abi));
}

/* --------------------------------------------------------------- entries */

export async function inflateRaw(bytes, { maxInflated = 64 * 1024 * 1024 } = {}) {
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
    fail("invalid_apk", "Dữ liệu nén bị hỏng.");
  }
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxInflated) {
        await reader.cancel().catch(() => {});
        fail("invalid_apk", "Dữ liệu sau giải nén vượt giới hạn.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ApkInspectError) throw error;
    if (error instanceof RangeError) {
      fail("invalid_apk", "Dữ liệu sau giải nén vượt giới hạn.");
    }
    fail("invalid_apk", "Dữ liệu nén không hợp lệ.");
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/**
 * Read one central-directory entry. Caps apply to both the compressed and the
 * uncompressed size so a zip bomb cannot allocate unbounded memory.
 */
export async function readEntryBytes(
  source,
  entry,
  {
    maxCompressed = 64 * 1024 * 1024,
    maxInflated = 64 * 1024 * 1024,
    label = entry?.name || "tệp",
  } = {},
) {
  if (!entry) fail("invalid_apk", `APK thiếu ${label}.`);
  if (entry.compressedSize > maxCompressed) {
    fail("invalid_apk", `${label} nén vượt giới hạn.`);
  }
  if (entry.uncompressedSize > maxInflated) {
    fail("invalid_apk", `${label} sau giải nén vượt giới hạn.`);
  }
  const header = await readRange(source, entry.localOffset, 30);
  if (readU32(header, 0) !== LOCAL_SIGNATURE) {
    fail("invalid_apk", `Local header của ${label} bị hỏng.`);
  }
  const nameLength = readU16(header, 26);
  const extraLength = readU16(header, 28);
  if (nameLength == null || extraLength == null) {
    fail("invalid_apk", `Local header của ${label} bị hỏng.`);
  }
  const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
  const raw = await readRange(source, dataOffset, entry.compressedSize);

  if (entry.method === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) {
      fail("invalid_apk", `${label} lưu trữ với kích thước sai.`);
    }
    if (raw.length > maxInflated) {
      fail("invalid_apk", `${label} sau giải nén vượt giới hạn.`);
    }
    return raw;
  }
  if (entry.method !== 8) {
    fail("invalid_apk", `${label} dùng phương thức nén không hỗ trợ.`);
  }
  if (typeof DecompressionStream === "undefined") {
    fail(
      "preview_unavailable",
      "Trình duyệt không hỗ trợ DecompressionStream; không xem trước được APK.",
    );
  }
  const inflated = await inflateRaw(raw, { maxInflated });
  if (inflated.length !== entry.uncompressedSize) {
    fail("invalid_apk", `${label} giải nén không khớp kích thước.`);
  }
  return inflated;
}

/**
 * Build a memoising entry reader for the icon preview. Unknown entries resolve
 * to null; parse problems surface as ApkInspectError to the caller.
 */
export function createEntryReader(source, entries) {
  const byName = new Map(entries.map((entry) => [entry.name, entry]));
  const cache = new Map();
  return async function readEntry(name, options = {}) {
    const key = `${name}:${options.maxCompressed || ""}:${options.maxInflated || ""}`;
    if (cache.has(key)) return cache.get(key);
    const entry = byName.get(name);
    if (!entry) return null;
    const bytes = await readEntryBytes(source, entry, { label: name, ...options });
    cache.set(key, bytes);
    return bytes;
  };
}

/* ----------------------------------------------------------- string pool */

/**
 * Parse an Android ResStringPool chunk (AXML or ARSC). Returns a getter that
 * decodes lazily; the cache keeps repeated attribute lookups cheap.
 */
export function parseStringPool(bytes, start, headerSize, chunkSize, options = {}) {
  if (headerSize < 28) fail("invalid_apk", "String pool bị hỏng.");
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
    fail("invalid_apk", "String pool bị hỏng.");
  }
  const maxStrings = options.maxStrings ?? MAX_STRING_POOL_STRINGS;
  if (stringCount > maxStrings) fail("invalid_apk", "String pool quá lớn.");
  const chunkEnd = start + chunkSize;
  const offsetsStart = start + headerSize;
  if (offsetsStart + stringCount * 4 + styleCount * 4 > chunkEnd) {
    fail("invalid_apk", "String pool bị hỏng.");
  }
  const stringsBase = start + stringsStart;
  if (stringsBase < start || stringsBase > chunkEnd) {
    fail("invalid_apk", "String pool bị hỏng.");
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
      fail("invalid_apk", "String pool bị hỏng.");
    }
    let text;
    if (utf8) {
      const charLength = decodeUtf8Length(bytes, cursor);
      if (!charLength) fail("invalid_apk", "String pool bị hỏng.");
      cursor = charLength.next;
      const byteLength = decodeUtf8Length(bytes, cursor);
      if (!byteLength) fail("invalid_apk", "String pool bị hỏng.");
      cursor = byteLength.next;
      if (cursor + byteLength.value > chunkEnd) {
        fail("invalid_apk", "String pool bị hỏng.");
      }
      text = utf8Decoder.decode(bytes.subarray(cursor, cursor + byteLength.value));
    } else {
      const charLength = decodeUtf16Length(bytes, cursor);
      if (!charLength) fail("invalid_apk", "String pool bị hỏng.");
      cursor = charLength.next;
      const byteLength = charLength.value * 2;
      if (cursor + byteLength > chunkEnd) {
        fail("invalid_apk", "String pool bị hỏng.");
      }
      text = utf16Decoder.decode(bytes.subarray(cursor, cursor + byteLength));
    }
    cache.set(index, text);
    return text;
  }

  return { get, count: stringCount };
}
