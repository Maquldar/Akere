import { inflateSync } from 'node:zlib';

/**
 * Face verification adapter (F-38, AS-04). The sandbox checks that the selfie is a real,
 * decodable JPEG/PNG photo of a plausible size. Real biometric matching against the employee's
 * reference photo needs a licensed provider (KNOWN_GAPS.md). A FAILED result never blocks the
 * mark; it is stored and flagged for review.
 */
export type FaceResult = { status: 'PASSED' | 'FAILED'; note: string | null };

export interface FaceVerifier {
  readonly sandbox: boolean;
  verify(image: Buffer, ctx?: { employeeId: string }): Promise<FaceResult>;
}

export const MIN_SIDE_PX = 64;
export const MAX_SIDE_PX = 10_000;

type Probe = { format: 'png' | 'jpeg'; width: number; height: number } | { error: string };

function probePng(buf: Buffer): Probe {
  if (buf.length < 33 || buf.readUInt32BE(12) !== 0x49484452) return { error: 'PNG без заголовка IHDR' };
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  // Walk the chunks and make sure the image data inflates.
  const idat: Buffer[] = [];
  let off = 8;
  let sawEnd = false;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    if (off + 12 + len > buf.length) return { error: 'PNG обрезан' };
    if (type === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    if (type === 'IEND') {
      sawEnd = true;
      break;
    }
    off += 12 + len;
  }
  if (!idat.length || !sawEnd) return { error: 'PNG без данных изображения' };
  try {
    inflateSync(Buffer.concat(idat));
  } catch {
    return { error: 'PNG не декодируется' };
  }
  return { format: 'png', width, height };
}

function probeJpeg(buf: Buffer): Probe {
  let off = 2;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) return { error: 'JPEG повреждён' };
    const marker = buf[off + 1]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2;
      continue;
    }
    const len = buf.readUInt16BE(off + 2);
    // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC) carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const height = buf.readUInt16BE(off + 5);
      const width = buf.readUInt16BE(off + 7);
      const tail = buf.subarray(Math.max(0, buf.length - 64));
      if (!tail.includes(Buffer.from([0xff, 0xd9]))) return { error: 'JPEG обрезан' };
      return { format: 'jpeg', width, height };
    }
    off += 2 + len;
  }
  return { error: 'JPEG без кадра' };
}

export function probeImage(buf: Buffer): Probe {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return probePng(buf);
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) return probeJpeg(buf);
  return { error: 'Неизвестный формат изображения' };
}

const sandbox: FaceVerifier = {
  sandbox: true,
  async verify(image) {
    const p = probeImage(image);
    if ('error' in p) return { status: 'FAILED', note: p.error };
    if (p.width < MIN_SIDE_PX || p.height < MIN_SIDE_PX) return { status: 'FAILED', note: `Снимок слишком маленький (${p.width}×${p.height})` };
    if (p.width > MAX_SIDE_PX || p.height > MAX_SIDE_PX) return { status: 'FAILED', note: `Недопустимый размер снимка (${p.width}×${p.height})` };
    return { status: 'PASSED', note: null };
  },
};

let current: FaceVerifier = sandbox;
export const faceVerifier = () => current;
/** Tests or a real provider integration can swap the implementation. */
export const setFaceVerifier = (v: FaceVerifier | null) => {
  current = v ?? sandbox;
};
