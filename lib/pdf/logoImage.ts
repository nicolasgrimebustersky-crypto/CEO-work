import type { JpegImage } from "./writer";

/**
 * The logo, as bytes ready to embed in a PDF.
 *
 * Fetched rather than bundled: it is 55KB, only a document export needs it,
 * and inlining it as base64 would put it in the JavaScript every screen loads.
 * The result is cached for the session, so a run of five invoices fetches once.
 */
let cached: Promise<JpegImage | null> | null = null;

export function loadLogoImage(): Promise<JpegImage | null> {
  cached ??= fetchLogo();
  return cached;
}

async function fetchLogo(): Promise<JpegImage | null> {
  try {
    const response = await fetch("/logo.jpg");
    if (!response.ok) return null;
    const data = new Uint8Array(await response.arrayBuffer());
    const size = readJpegSize(data);
    return size ? { data, ...size } : null;
  } catch {
    // Offline, or the file is missing. The document is still worth producing;
    // it just goes out with the business name and no mark.
    return null;
  }
}

/**
 * Width and height from a JPEG's frame header.
 *
 * A JPEG is a chain of segments: 0xFF, a marker byte, then a two-byte length.
 * Every SOFn marker except the four that mean something else carries the
 * dimensions in its first five bytes. Read rather than hardcoded, so replacing
 * the artwork cannot silently stretch it on every invoice.
 */
function readJpegSize(data: Uint8Array): { width: number; height: number } | null {
  if (data[0] !== 0xff || data[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = data[offset + 1];

    // SOF0–SOF15, excluding DHT (c4), DAC (cc) and the RSTn range (d0–d7).
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xcc;
    if (isFrame) {
      return {
        height: (data[offset + 5] << 8) | data[offset + 6],
        width: (data[offset + 7] << 8) | data[offset + 8],
      };
    }

    // Standalone markers carry no length field; everything else does.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    offset += 2 + ((data[offset + 2] << 8) | data[offset + 3]);
  }
  return null;
}
