// Reads single files out of a .zip held in memory (stored or deflated entries, no zip64), so the Windows bundle builder
// needs neither unzip nor tar -x on the build machine. Sizes and CRC-32 are checked on every extraction.
import { crc32, inflateRawSync } from "node:zlib";

const END_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const END_RECORD_BYTES = 22;
const MAX_COMMENT_BYTES = 0xffff;

function endOfCentralDirectory(zip: Buffer): number {
  const lowest = Math.max(0, zip.length - END_RECORD_BYTES - MAX_COMMENT_BYTES);
  for (let offset = zip.length - END_RECORD_BYTES; offset >= lowest; offset -= 1) {
    if (zip.readUInt32LE(offset) === END_SIGNATURE) return offset;
  }
  throw new Error("not a zip file: no end-of-central-directory record");
}

/** One central-directory record of a zip archive. */
export interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly size: number;
  readonly localOffset: number;
}

/** Every entry of the archive as { name, method, crc, compressedSize, size, localOffset }. */
export function zipEntries(zip: Buffer): ZipEntry[] {
  const end = endOfCentralDirectory(zip);
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (zip.readUInt32LE(offset) !== CENTRAL_SIGNATURE) throw new Error("corrupt zip central directory");
    const nameLength = zip.readUInt16LE(offset + 28);
    entries.push({
      name: zip.toString("utf8", offset + 46, offset + 46 + nameLength),
      method: zip.readUInt16LE(offset + 10),
      crc: zip.readUInt32LE(offset + 16),
      compressedSize: zip.readUInt32LE(offset + 20),
      size: zip.readUInt32LE(offset + 24),
      localOffset: zip.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + zip.readUInt16LE(offset + 30) + zip.readUInt16LE(offset + 32);
  }
  return entries;
}

/** The bytes of one entry, inflated and checked against the recorded size and CRC-32. */
export function extractEntry(zip: Buffer, entry: ZipEntry): Buffer {
  if (zip.readUInt32LE(entry.localOffset) !== LOCAL_SIGNATURE) throw new Error(`corrupt local header for ${entry.name}`);
  const start = entry.localOffset + 30 + zip.readUInt16LE(entry.localOffset + 26) + zip.readUInt16LE(entry.localOffset + 28);
  const raw = zip.subarray(start, start + entry.compressedSize);
  if (entry.method !== 0 && entry.method !== 8) throw new Error(`${entry.name} uses unsupported compression method ${entry.method}`);
  const bytes = entry.method === 0 ? raw : inflateRawSync(raw);
  if (bytes.length !== entry.size || crc32(bytes) !== entry.crc) throw new Error(`${entry.name} failed its size or CRC-32 check`);
  return bytes;
}

/** The bytes of the first entry named `name` once the single top-level folder is ignored (node-v1.2.3-win-x64/node.exe -> node.exe). */
export function extractTopLevelFile(zip: Buffer, name: string): Buffer {
  const entry = zipEntries(zip).find((candidate) => candidate.name.split("/").slice(1).join("/") === name);
  if (!entry) throw new Error(`the archive has no ${name} directly inside its top-level folder`);
  return extractEntry(zip, entry);
}
