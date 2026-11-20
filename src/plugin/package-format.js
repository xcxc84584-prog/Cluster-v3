/** Portable plugin ZIP format: safe paths, CRC-32, STORE and DEFLATE. */
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const MAX_FILES = 500;
const MAX_UNPACKED = 16 * 1024 * 1024;
const MAX_ARCHIVE = 20 * 1024 * 1024;
const RESERVED = "cluster.pmu";

export function packageError(code, message) {
  const err = new Error(message);
  err.code = code;
  err.status = 400;
  return err;
}
export function normalizePackagePath(path) {
  if (typeof path !== "string") throw packageError("INVALID_PATH", "Not a string");
  const value = path.replaceAll("\\", "/");
  if (!value || value.startsWith("/") || value.includes("\0") ||
      /^[a-zA-Z]:/.test(value) || value.split("/").some(x =>
        x === ".." || x === "." || x === "")) {
    throw packageError("INVALID_PATH", path);
  }
  return value;
}
const table = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  table[n] = c >>> 0;
}
export function crc32(buffer) {
  let result = 0xffffffff;
  for (const byte of buffer) result = table[(result ^ byte) & 255] ^ (result >>> 8);
  return (result ^ 0xffffffff) >>> 0;
}
function bytes(source) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (typeof source === "string") return encoder.encode(source);
  throw packageError("BAD_CONTENT", "Expected bytes or UTF-8 text");
}
function concat(parts) {
  const output = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
const u16 = (view, at) => view.getUint16(at, true);
const u32 = (view, at) => view.getUint32(at, true);
const write16 = (view, at, v) => view.setUint16(at, v, true);
const write32 = (view, at, v) => view.setUint32(at, v >>> 0, true);

/** Generates a standards-compliant STORE ZIP for the download template. */
export function createZip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [path, source] of Object.entries(files)) {
    const name = encoder.encode(normalizePackagePath(path));
    const content = bytes(source);
    if (name.length > 65535 || content.length > MAX_UNPACKED)
      throw packageError("LIMIT_EXCEEDED", path);
    const checksum = crc32(content);
    const header = new Uint8Array(30 + name.length);
    const lv = new DataView(header.buffer);
    write32(lv, 0, 0x04034b50);
    write16(lv, 4, 20);
    write16(lv, 6, 0x0800);
    write16(lv, 8, 0);
    write32(lv, 14, checksum);
    write32(lv, 18, content.length);
    write32(lv, 22, content.length);
    write16(lv, 26, name.length);
    header.set(name, 30);
    local.push(header, content);
    const dir = new Uint8Array(46 + name.length);
    const dv = new DataView(dir.buffer);
    write32(dv, 0, 0x02014b50);
    write16(dv, 4, 20);
    write16(dv, 6, 20);
    write16(dv, 8, 0x0800);
    write16(dv, 10, 0);
    write32(dv, 16, checksum);
    write32(dv, 20, content.length);
    write32(dv, 24, content.length);
    write16(dv, 28, name.length);
    write32(dv, 42, offset);
    dir.set(name, 46);
    central.push(dir);
    offset += header.length + content.length;
  }
  if (central.length > MAX_FILES) throw packageError("LIMIT_EXCEEDED", "Too many files");
  const directory = concat(central);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  write32(ev, 0, 0x06054b50);
  write16(ev, 8, central.length);
  write16(ev, 10, central.length);
  write32(ev, 12, directory.length);
  write32(ev, 16, offset);
  return concat([...local, directory, end]);
}

/** Reads regular ZIP archives; supports DEFLATE if runtime supports deflate-raw. */
export async function readZip(raw) {
  const input = bytes(raw);
  if (input.length > MAX_ARCHIVE) throw packageError("LIMIT_EXCEEDED", "ZIP too large");
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  let end = -1;
  for (let pos = input.length - 22; pos >= Math.max(0, input.length - 65557); pos--) {
    if (u32(view, pos) === 0x06054b50) { end = pos; break; }
  }
  if (end < 0) throw packageError("INVALID_ZIP", "Missing ZIP central directory");
  if (u16(view, end + 4) !== 0 || u16(view, end + 6) !== 0)
    throw packageError("MULTIDISK_ZIP", "Multi-disk archive not supported");
  const count = u16(view, end + 10);
  const dirSize = u32(view, end + 12), dirStart = u32(view, end + 16);
  if (count > MAX_FILES || dirStart + dirSize > end)
    throw packageError("INVALID_ZIP", "Invalid central directory");
  const result = {};
  let at = dirStart, total = 0;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || u32(view, at) !== 0x02014b50)
      throw packageError("INVALID_ZIP", "Invalid directory entry");
    const flags = u16(view, at + 8), method = u16(view, at + 10);
    const checksum = u32(view, at + 16);
    const packed = u32(view, at + 20), unpacked = u32(view, at + 24);
    const nameLength = u16(view, at + 28), extra = u16(view, at + 30);
    const comment = u16(view, at + 32), localAt = u32(view, at + 42);
    if (flags & 1 || ![0, 8].includes(method))
      throw packageError("UNSUPPORTED_ZIP", "Encrypted or unsupported ZIP entry");
    if (at + 46 + nameLength + extra + comment > end)
      throw packageError("INVALID_ZIP", "Truncated file name");
    const name = decoder.decode(input.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extra + comment;
    if (name.endsWith("/")) continue;
    const path = normalizePackagePath(name);
    total += unpacked;
    if (total > MAX_UNPACKED) throw packageError("LIMIT_EXCEEDED", "Unpacked size too large");
    if (Object.hasOwn(result, path)) throw packageError("DUPLICATE_FILE", path);
    if (localAt + 30 > input.length || u32(view, localAt) !== 0x04034b50)
      throw packageError("INVALID_ZIP", "Missing local header");
    if (u16(view, localAt + 8) !== method)
      throw packageError("INVALID_ZIP", "Compression method differs");
    const dataAt = localAt + 30 + u16(view, localAt + 26) + u16(view, localAt + 28);
    if (dataAt + packed > input.length)
      throw packageError("INVALID_ZIP", "Truncated file");
    const payload = input.slice(dataAt, dataAt + packed);
    let data = payload;
    if (method === 8) {
      if (typeof DecompressionStream === "undefined")
        throw packageError("UNSUPPORTED_ZIP", "Browser cannot decompress DEFLATE ZIP");
      try {
        const stream = new Blob([payload]).stream().pipeThrough(
          new DecompressionStream("deflate-raw"));
        // Don't trust the uncompressed length; read at most the allowed limit.
        const reader = stream.getReader();
        const pieces = [];
        let length = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > unpacked || length > MAX_UNPACKED)
            throw packageError("LIMIT_EXCEEDED", "DEFLATE stream exceeded advertised size");
          pieces.push(value);
        }
        data = concat(pieces);
      } catch (err) {
        throw packageError("INVALID_ZIP", "Could not decompress: " + err.message);
      }
    }
    if (data.length !== unpacked || crc32(data) !== checksum)
      throw packageError("ZIP_CRC_MISMATCH", path);
    result[path] = data;
  }
  return result;
}
export function validatePluginPackage(files) {
  const keys = Object.keys(files);
  if (!keys.length || keys.length > MAX_FILES)
    throw packageError("BAD_PACKAGE", "No files or too many files");
  const normalized = {};
  let total = 0;
  for (const [file, source] of Object.entries(files)) {
    const key = normalizePackagePath(file);
    if (Object.hasOwn(normalized, key)) throw packageError("DUPLICATE_FILE", key);
    const data = bytes(source);
    total += data.byteLength;
    if (total > MAX_UNPACKED) throw packageError("LIMIT_EXCEEDED", "Package too large");
    normalized[key] = data;
  }
  let prefix = "";
  if (!normalized["manifest.json"]) {
    const roots = new Set(keys.map(key => key.split("/")[0]));
    if (roots.size === 1 && normalized[[...roots][0] + "/manifest.json"])
      prefix = [...roots][0] + "/";
  }
  if (prefix) {
    const compact = {};
    for (const [key, value] of Object.entries(normalized))
      compact[key.slice(prefix.length)] = value;
    return validatePluginPackage(compact);
  }
  if (!normalized["manifest.json"])
    throw packageError("MISSING_MANIFEST", "manifest.json is required at package root");
  let manifest;
  try { manifest = JSON.parse(decoder.decode(normalized["manifest.json"])); }
  catch { throw packageError("INVALID_MANIFEST", "Invalid JSON manifest"); }
  if (!manifest || manifest.schemaVersion !== "1.0.0" ||
      !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(manifest.id || "") ||
      manifest.id === RESERVED || typeof manifest.name !== "string" ||
      !manifest.name.trim() ||
      !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version || "")) {
    throw packageError("INVALID_MANIFEST", "Invalid schemaVersion/id/name/version");
  }
  // UI placement is independent of the plugin business code.
  // A plugin can be embedded in Cluster, opened standalone, or both.
  if (manifest.ui !== undefined) {
    if (!manifest.ui || typeof manifest.ui !== "object" ||
        !["embedded", "standalone", "both"].includes(manifest.ui.mode))
      throw packageError("INVALID_MANIFEST", "ui.mode must be embedded, standalone or both");
    if (manifest.ui.home !== undefined && typeof manifest.ui.home !== "boolean")
      throw packageError("INVALID_MANIFEST", "ui.home must be boolean");
  }
  for (const key of ["entry", "settings", "community"]) {
    if (key === "entry" && !manifest.entry)
      throw packageError("INVALID_MANIFEST", "Missing entry HTML");
    if (!manifest[key]) continue;
    const path = normalizePackagePath(manifest[key]);
    if (!path.toLowerCase().endsWith(".html") || !normalized[path])
      throw packageError("MISSING_ENTRY", key + " must point to a local HTML file");
  }
  return { manifest: structuredClone(manifest), files: normalized };
}
