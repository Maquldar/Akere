import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

/**
 * Minimal block-based PDF layout engine (A4) used for generated HR documents,
 * the personal-file sandbox report and signature sheets. Noto Sans covers Cyrillic + Kazakh.
 */
export type Block =
  | { type: 'heading'; text: string; align?: 'left' | 'center'; size?: number }
  | { type: 'paragraph'; text: string; size?: number; bold?: boolean; align?: 'left' | 'center' | 'right' }
  | { type: 'fields'; rows: { label: string; value: string }[] }
  | { type: 'banner'; text: string; color?: 'green' | 'blue' | 'gray' }
  | { type: 'signatures'; parties: { label: string; name: string }[] }
  | { type: 'image'; png?: Uint8Array; jpg?: Uint8Array; width: number; height: number; align?: 'left' | 'right' }
  | { type: 'spacer'; height?: number };

const here = dirname(fileURLToPath(import.meta.url));
// Works from src/lib (tsx) and dist/ (bundled): walk up to the package root.
const fontDir = [resolve(here, '../../assets/fonts'), resolve(here, '../assets/fonts'), resolve(process.cwd(), 'assets/fonts')].find((p) => {
  try {
    readFileSync(resolve(p, 'NotoSans-Regular.ttf'));
    return true;
  } catch {
    return false;
  }
})!;
const regularBytes = readFileSync(resolve(fontDir, 'NotoSans-Regular.ttf'));
const boldBytes = readFileSync(resolve(fontDir, 'NotoSans-Bold.ttf'));

const A4: [number, number] = [595.28, 841.89];
const M = 56; // margins
const COLORS: Record<string, RGB> = { green: rgb(0.24, 0.62, 0.42), blue: rgb(0.14, 0.2, 0.84), gray: rgb(0.45, 0.45, 0.45) };
const TEXT = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.42, 0.42, 0.46);

export class PdfBuilder {
  private constructor(
    private doc: PDFDocument,
    private regular: PDFFont,
    private bold: PDFFont,
  ) {}
  private page!: PDFPage;
  private y = 0;
  private footer = '';

  static async create(opts: { title: string; footer?: string }) {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    doc.setTitle(opts.title);
    doc.setProducer('Akere HR');
    doc.setCreator('Akere HR');
    const b = new PdfBuilder(doc, await doc.embedFont(regularBytes, { subset: false }), await doc.embedFont(boldBytes, { subset: false }));
    b.footer = opts.footer ?? '';
    b.newPage();
    return b;
  }

  private newPage() {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - M;
    if (this.footer) {
      this.page.drawText(this.footer, { x: M, y: 28, size: 7.5, font: this.regular, color: MUTED });
    }
  }

  private ensure(h: number) {
    if (this.y - h < M) this.newPage();
  }

  private wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > width && line) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      lines.push(line);
    }
    return lines;
  }

  private text(text: string, opts: { size: number; bold?: boolean; align?: 'left' | 'center' | 'right'; color?: RGB; x?: number; width?: number }) {
    const font = opts.bold ? this.bold : this.regular;
    const x0 = opts.x ?? M;
    const width = opts.width ?? A4[0] - 2 * M;
    const lh = opts.size * 1.4;
    for (const line of this.wrap(text, font, opts.size, width)) {
      this.ensure(lh);
      const w = font.widthOfTextAtSize(line, opts.size);
      const x = opts.align === 'center' ? x0 + (width - w) / 2 : opts.align === 'right' ? x0 + width - w : x0;
      this.page.drawText(line, { x, y: this.y - opts.size, size: opts.size, font, color: opts.color ?? TEXT });
      this.y -= lh;
    }
  }

  async add(blocks: Block[]) {
    for (const b of blocks) {
      switch (b.type) {
        case 'heading':
          this.y -= 6;
          this.text(b.text, { size: b.size ?? 14, bold: true, align: b.align ?? 'center' });
          this.y -= 6;
          break;
        case 'paragraph':
          this.text(b.text, { size: b.size ?? 10.5, bold: b.bold, align: b.align });
          this.y -= 4;
          break;
        case 'fields': {
          const labelW = 170;
          for (const r of b.rows) {
            const valueLines = this.wrap(r.value || '—', this.regular, 10, A4[0] - 2 * M - labelW);
            const h = Math.max(1, valueLines.length) * 14 + 2;
            this.ensure(h);
            const top = this.y;
            this.page.drawText(r.label, { x: M, y: top - 10, size: 9, font: this.bold, color: MUTED });
            valueLines.forEach((l, i) => this.page.drawText(l, { x: M + labelW, y: top - 10 - i * 14, size: 10, font: this.regular, color: TEXT }));
            this.y -= h;
          }
          this.y -= 4;
          break;
        }
        case 'banner':
          this.ensure(26);
          this.page.drawRectangle({ x: M, y: this.y - 20, width: A4[0] - 2 * M, height: 20, color: COLORS[b.color ?? 'green'] });
          this.page.drawText(b.text, {
            x: M + (A4[0] - 2 * M - this.bold.widthOfTextAtSize(b.text, 10)) / 2, y: this.y - 14, size: 10, font: this.bold, color: rgb(1, 1, 1),
          });
          this.y -= 28;
          break;
        case 'signatures': {
          this.y -= 10;
          const colW = (A4[0] - 2 * M) / Math.max(1, b.parties.length);
          this.ensure(60);
          b.parties.forEach((p, i) => {
            const x = M + i * colW;
            this.page.drawText(p.label, { x, y: this.y - 10, size: 9, font: this.bold, color: MUTED });
            this.page.drawLine({ start: { x, y: this.y - 38 }, end: { x: x + colW - 24, y: this.y - 38 }, thickness: 0.6, color: MUTED });
            this.page.drawText(p.name, { x, y: this.y - 50, size: 9.5, font: this.regular, color: TEXT });
          });
          this.y -= 64;
          break;
        }
        case 'image': {
          const img = b.png ? await this.doc.embedPng(b.png) : await this.doc.embedJpg(b.jpg!);
          this.ensure(b.height + 8);
          const x = b.align === 'right' ? A4[0] - M - b.width : M;
          this.page.drawImage(img, { x, y: this.y - b.height, width: b.width, height: b.height });
          this.y -= b.height + 8;
          break;
        }
        case 'spacer':
          this.y -= b.height ?? 12;
          break;
      }
    }
    return this;
  }

  /** Draw an image at an absolute position on the current page (e.g. photo next to fields). */
  async imageAt(bytes: Uint8Array, kind: 'png' | 'jpg', x: number, yFromTop: number, w: number, h: number) {
    const img = kind === 'png' ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes);
    this.page.drawImage(img, { x, y: A4[1] - yFromTop - h, width: w, height: h });
  }

  async bytes(): Promise<Buffer> {
    return Buffer.from(await this.doc.save());
  }
}

/** Append a signature sheet to an existing PDF (signed version). */
export async function appendSignatureSheet(
  pdf: Uint8Array,
  opts: { title: string; docHash: string; signatures: { signer: string; method: string; signedAt: string; onBehalfOf?: string | null; fingerprint: string }[] },
) {
  const doc = await PDFDocument.load(pdf);
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(regularBytes, { subset: false });
  const bold = await doc.embedFont(boldBytes, { subset: false });
  let page = doc.addPage(A4);
  let y = A4[1] - M;
  const line = (t: string, size = 10, f = regular, color = TEXT) => {
    if (y < M + 20) {
      page = doc.addPage(A4);
      y = A4[1] - M;
    }
    page.drawText(t, { x: M, y: y - size, size, font: f, color });
    y -= size * 1.5;
  };
  line('Лист подписания / Қол қою парағы', 14, bold);
  line(opts.title, 11, bold);
  line(`SHA-256 документа: ${opts.docHash}`, 8, regular, MUTED);
  y -= 8;
  for (const s of opts.signatures) {
    line(s.signer, 10.5, bold);
    line(`Способ: ${s.method} · Подписано: ${s.signedAt}${s.onBehalfOf ? ` · за: ${s.onBehalfOf}` : ''}`, 9, regular, MUTED);
    line(`Отпечаток ключа: ${s.fingerprint}`, 8, regular, MUTED);
    y -= 6;
  }
  line('Подписано в Akere HR (sandbox). Подпись не имеет юридической силы без интеграции с НУЦ РК.', 8, regular, MUTED);
  return Buffer.from(await doc.save());
}
