/**
 * Minimal ZIP central-directory reader (no decompression): finds the End Of Central Directory record and sums the
 * declared uncompressed sizes of all entries. Used to refuse zip bombs (XLSX is a ZIP) before handing the file to a
 * parser that inflates everything in memory. Returns null when the buffer is not a well-formed ZIP or uses ZIP64
 * (never needed for the small spreadsheets we accept). Note: sizes are as declared by the archive; the parser must
 * still run on size-capped input (the upload itself is capped).
 */
export function zipStats(buf: Buffer): { entries: number; uncompressedBytes: number } | null {
  const EOCD = 0x06054b50;
  const CDH = 0x02014b50;
  const minEocd = 22;
  if (buf.length < minEocd) return null;
  let eocd = -1;
  const stop = Math.max(0, buf.length - minEocd - 0xffff);
  for (let i = buf.length - minEocd; i >= stop; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return null; // ZIP64
  if (cdOffset + cdSize > eocd) return null;
  let p = cdOffset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== CDH) return null;
    const size = buf.readUInt32LE(p + 24);
    if (size === 0xffffffff) return null; // ZIP64 entry
    total += size;
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return { entries, uncompressedBytes: total };
}
