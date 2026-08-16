/**
 * A very small PDF writer.
 *
 * Why not a library: the two obvious choices weigh 350KB and 1MB, and this app
 * is opened on a phone in a driveway. What an estimate actually needs is text,
 * rectangles and colour, and PDF has all three built in — the format is a list
 * of numbered objects and a table saying where each one starts.
 *
 * The other reason is fonts. Embedding a typeface means subsetting a TTF and
 * writing font descriptors; but the PDF spec guarantees fourteen faces that
 * every reader already has, and Helvetica is one of them. Using it means the
 * output is a few kilobytes of crisp vector text with nothing embedded, which
 * is also why it opens instantly in the iOS share sheet.
 *
 * Coordinates are PDF's own: origin bottom-left, y grows upward, units are
 * points at 72 per inch. `Doc` below flips that so callers can think top-down.
 */

export const PT_PER_INCH = 72;
/** US Letter, which is what every customer here prints on. */
export const PAGE_WIDTH = 8.5 * PT_PER_INCH;
export const PAGE_HEIGHT = 11 * PT_PER_INCH;

export type FontName = "Helvetica" | "Helvetica-Bold";

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** "#22c55e" -> {r,g,b} in 0–1, which is what PDF's colour operators want. */
export function hexToRgb(hex: string): RGB {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16) / 255,
    g: parseInt(clean.slice(2, 4), 16) / 255,
    b: parseInt(clean.slice(4, 6), 16) / 255,
  };
}

/**
 * Text width in points.
 *
 * Measured with a canvas rather than from embedded metric tables — the browser
 * already has Helvetica's widths, and shipping 256 advance values per face to
 * duplicate them would be a lot of code to get subtly wrong. Falls back to a
 * rough average where there is no canvas, which only affects right-aligned
 * columns during a server render that never happens.
 */
let measureCanvas: HTMLCanvasElement | null = null;

export function textWidth(text: string, size: number, font: FontName): number {
  if (typeof document === "undefined") return text.length * size * 0.5;
  if (!measureCanvas) measureCanvas = document.createElement("canvas");
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) return text.length * size * 0.5;
  ctx.font = `${font === "Helvetica-Bold" ? "bold " : ""}${size}px Helvetica, Arial, sans-serif`;
  return ctx.measureText(text).width;
}

/** Backslash, and both parens, are what end a PDF string literal early. */
function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

/**
 * PDF strings are bytes, not Unicode. WinAnsi covers the Latin-1 range, and
 * anything outside it — a curly quote pasted from a phone keyboard, an em
 * dash — is mapped to its nearest plain equivalent rather than being dropped,
 * because a missing character in a price description is worse than a straight
 * quote where a curly one was meant.
 */
const TRANSLITERATE: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "–": "-",
  "—": "-",
  "…": "...",
  " ": " ",
  "−": "-",
  "×": "x",
  "·": "-",
};

export function toWinAnsi(text: string): string {
  let out = "";
  for (const char of text) {
    const mapped = TRANSLITERATE[char];
    if (mapped !== undefined) {
      out += mapped;
      continue;
    }
    out += char.codePointAt(0)! <= 0xff ? char : "?";
  }
  return out;
}

export interface TextOptions {
  size?: number;
  font?: FontName;
  color?: RGB;
  /** Where `x` refers to. Right and centre are measured, not guessed. */
  align?: "left" | "right" | "center";
}

const BLACK: RGB = { r: 0, g: 0, b: 0 };

/**
 * A shape, in top-down coordinates. `curve` takes two control points and an
 * end point, matching PDF's own cubic operator.
 */
export type PathSegment =
  | { move: [number, number] }
  | { line: [number, number] }
  | { curve: [number, number, number, number, number, number] };

function pathOps(path: PathSegment[]): string {
  const flip = (y: number) => round(PAGE_HEIGHT - y);
  const out: string[] = [];

  for (const segment of path) {
    if ("move" in segment) {
      out.push(`${round(segment.move[0])} ${flip(segment.move[1])} m`);
    } else if ("line" in segment) {
      out.push(`${round(segment.line[0])} ${flip(segment.line[1])} l`);
    } else {
      const [x1, y1, x2, y2, x3, y3] = segment.curve;
      out.push(
        `${round(x1)} ${flip(y1)} ${round(x2)} ${flip(y2)} ${round(x3)} ${flip(y3)} c`,
      );
    }
  }
  out.push("h");
  return out.join(" ");
}

/**
 * One page of drawing commands.
 *
 * `y` in every method is measured from the top of the page, because that is
 * how a document is laid out in the head; the flip to PDF's bottom-left origin
 * happens here, once, rather than at every call site.
 */
export interface JpegImage {
  /** The file's bytes, unmodified. */
  data: Uint8Array;
  width: number;
  height: number;
}

export class Doc {
  private ops: string[] = [];
  private fontsUsed = new Set<FontName>(["Helvetica"]);
  private image: JpegImage | null = null;

  /**
   * Places a JPEG.
   *
   * PDF carries JPEG data verbatim through /DCTDecode, so the file's bytes go
   * in untouched — no decoding, no re-encoding, no pixel buffer. That is the
   * whole reason the logo derivative is a JPEG: a PNG would have to be
   * inflated, un-filtered and re-deflated here, which is a decoder this file
   * has no business containing.
   *
   * One image per document is all an estimate needs, so there is one slot
   * rather than a resource dictionary to manage.
   */
  drawImage(image: JpegImage, x: number, y: number, width: number, height: number): void {
    this.image = image;
    // Images are drawn into a unit square, so the matrix does the placing:
    // scale to the box, then translate to the bottom-left corner of it.
    this.ops.push(
      "q",
      `${round(width)} 0 0 ${round(height)} ${round(x)} ${round(PAGE_HEIGHT - y - height)} cm`,
      "/Im1 Do",
      "Q",
    );
  }

  fill(color: RGB): void {
    this.ops.push(`${round(color.r)} ${round(color.g)} ${round(color.b)} rg`);
  }

  rect(x: number, y: number, width: number, height: number, color: RGB): void {
    this.fill(color);
    this.ops.push(`${round(x)} ${round(PAGE_HEIGHT - y - height)} ${round(width)} ${round(height)} re f`);
  }

  /** A horizontal rule. Thin rectangles beat stroked lines: no line-cap maths. */
  line(x: number, y: number, width: number, color: RGB, thickness = 0.75): void {
    this.rect(x, y, width, thickness, color);
  }

  /**
   * An arbitrary filled shape, in top-down coordinates.
   *
   * `path` is a list of segments: a move, then lines and cubic curves. PDF has
   * no arc operator, so circles arrive here already expressed as curves — see
   * the droplet in documentPdf.ts.
   *
   * `clip` fills the shape and then confines everything drawn inside the
   * callback to it, which is how the logo gets its two-tone interior without
   * needing a second copy of the outline.
   */
  shape(path: PathSegment[], color: RGB, clip?: () => void): void {
    this.fill(color);
    this.ops.push(pathOps(path));
    if (!clip) {
      this.ops.push("f");
      return;
    }
    // q/Q brackets the clip so it does not leak into later drawing.
    this.ops.push("q", "f", pathOps(path), "W n");
    clip();
    this.ops.push("Q");
  }

  text(value: string, x: number, y: number, options: TextOptions = {}): void {
    const { size = 10, font = "Helvetica", color = BLACK, align = "left" } = options;
    const clean = toWinAnsi(value);
    if (!clean) return;

    this.fontsUsed.add(font);
    let drawX = x;
    if (align !== "left") {
      const width = textWidth(clean, size, font);
      drawX = align === "right" ? x - width : x - width / 2;
    }

    this.fill(color);
    // y is the text baseline, so the caller's y is the top of the line box.
    const baseline = PAGE_HEIGHT - y - size * 0.8;
    this.ops.push(
      `BT /${font === "Helvetica-Bold" ? "F2" : "F1"} ${round(size)} Tf ` +
        `${round(drawX)} ${round(baseline)} Td (${escapeText(clean)}) Tj ET`,
    );
  }

  /**
   * Text wrapped to a width, returning the y the caller should continue from.
   * Wrapping is done here rather than by the caller because it needs the same
   * measurement the drawing does.
   */
  paragraph(
    value: string,
    x: number,
    y: number,
    maxWidth: number,
    options: TextOptions & { lineHeight?: number } = {},
  ): number {
    const { size = 10, font = "Helvetica", lineHeight = 1.35 } = options;
    const step = size * lineHeight;
    let cursor = y;

    for (const paragraph of value.split("\n")) {
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (textWidth(toWinAnsi(candidate), size, font) > maxWidth && line) {
          this.text(line, x, cursor, options);
          cursor += step;
          line = word;
        } else {
          line = candidate;
        }
      }
      if (line) {
        this.text(line, x, cursor, options);
        cursor += step;
      }
    }
    return cursor;
  }

  /** The assembled PDF, ready to be handed to a Blob. */
  build(): Uint8Array {
    const content = this.ops.join("\n");
    const image = this.image;
    const xobject = image ? " /XObject << /Im1 7 0 R >>" : "";

    const objects: string[] = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${round(PAGE_WIDTH)} ${round(PAGE_HEIGHT)}] ` +
        `/Resources << /Font << /F1 5 0 R /F2 6 0 R >>${xobject} >> /Contents 4 0 R >>`,
      `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ];
    if (image) {
      objects.push(
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
          `/Length ${image.data.length} >>\nstream\n IMAGE \nendstream`,
      );
    }

    // Assembled as bytes rather than as a string, because the JPEG payload is
    // arbitrary binary: putting it through a string would corrupt it, and the
    // xref table's offsets have to count real bytes either way.
    const chunks: Uint8Array[] = [];
    let length = 0;
    const push = (part: Uint8Array | string) => {
      const bytes = typeof part === "string" ? latin1(part) : part;
      chunks.push(bytes);
      length += bytes.length;
    };

    push("%PDF-1.4\n");
    const offsets: number[] = [];
    objects.forEach((body, index) => {
      offsets.push(length);
      // The image object's stream is spliced in around its placeholder, so the
      // binary never has to survive a round trip through a JS string.
      const marker = body.indexOf(" IMAGE ");
      if (marker === -1 || !image) {
        push(`${index + 1} 0 obj\n${body}\nendobj\n`);
        return;
      }
      push(`${index + 1} 0 obj\n${body.slice(0, marker)}`);
      push(image.data);
      push(`${body.slice(marker + 7)}\nendobj\n`);
    });

    const xrefStart = length;
    let tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
      tail += `${String(offset).padStart(10, "0")} 00000 n \n`;
    }
    tail += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
    push(tail);

    const out = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}

/**
 * Latin-1, not UTF-8: everything written above is already in that range after
 * toWinAnsi, and a multi-byte encoding would shift every offset in the xref
 * table and make the file unreadable.
 */
function latin1(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) bytes[i] = value.charCodeAt(i) & 0xff;
  return bytes;
}

/** Byte length under Latin-1, which is what build() writes. */
function byteLength(value: string): number {
  return value.length;
}

/** PDF wants plain decimals; exponent notation is not valid syntax. */
function round(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}
