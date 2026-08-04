/**
 * Regenerates every app icon and launch image from public/logo.svg.
 *
 *   node scripts/generate-icons.mjs
 *
 * One source of truth: edit the SVG, run this, commit what changes. Doing it
 * by hand across nine files is how an icon set drifts — you update the ones
 * you happen to look at and the 8-plus splash keeps last year's mark.
 *
 * Renders through a real browser rather than an image library, because the
 * mark is SVG with gradients and clip paths and a browser is the renderer
 * guaranteed to agree with what actually ships.
 *
 * Playwright is NOT a dependency of this project — it would pull a browser
 * download into every install and every CI run, to regenerate nine files that
 * change about once a year. Install it just when you need it:
 *
 *   npm i --no-save playwright && node scripts/generate-icons.mjs
 */
let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error(
    "This script needs Playwright, which is deliberately not a dependency.\n" +
      "Run:  npm i --no-save playwright && node scripts/generate-icons.mjs",
  );
  process.exit(1);
}

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
const svg = readFileSync(`${ROOT}/logo.svg`, "utf8");
// CHROMIUM_PATH lets this run against a browser that is already on the
// machine, instead of one Playwright downloaded for itself.
const b = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});

/** Square icon at an exact pixel size, transparent outside the rounded corners. */
async function icon(size, out) {
  const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(
    `<body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${svg}</div></body>`
  );
  await p.waitForTimeout(120);
  const buf = await p.screenshot({ omitBackground: true });
  writeFileSync(out, buf);
  await p.close();
  console.log(`${out.split("/").pop()}  ${size}x${size}`);
}

/**
 * Apple touch icons are composited onto a white sheet by iOS if they have
 * alpha, so this one gets the canvas painted in and square corners — iOS
 * applies its own mask.
 */
async function appleIcon(size, out) {
  const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const squared = svg.replace('rx="116"', 'rx="0"');
  await p.setContent(
    `<body style="margin:0;background:#050607"><div style="width:${size}px;height:${size}px">${squared}</div></body>`
  );
  await p.waitForTimeout(120);
  writeFileSync(out, await p.screenshot());
  await p.close();
  console.log(`${out.split("/").pop()}  ${size}x${size} (opaque)`);
}

/** Launch image: the mark centred on the canvas colour, at device resolution. */
async function splash(w, h, out) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const mark = Math.round(Math.min(w, h) * 0.30);
  await p.setContent(`
    <body style="margin:0;background:#050607;display:flex;align-items:center;justify-content:center">
      <div style="width:${mark}px;height:${mark}px">${svg}</div>
    </body>`);
  await p.waitForTimeout(120);
  writeFileSync(out, await p.screenshot());
  await p.close();
  console.log(`${out.split("/").pop()}  ${w}x${h}`);
}


/**
 * A multi-size .ico, assembled by hand.
 *
 * The format is a 6-byte header, a 16-byte directory entry per image, then the
 * images — and every browser still in use accepts PNG payloads inside an ICO,
 * so each entry is the PNG bytes with its offset recorded. Six fields of
 * little-endian integers is not worth a dependency.
 */
async function favicon(out) {
  const sizes = [16, 32, 48];
  const pngs = [];
  for (const size of sizes) {
    const p = await b.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await p.setContent(
      `<body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px">${svg}</div></body>`
    );
    await p.waitForTimeout(120);
    pngs.push(await p.screenshot({ omitBackground: true }));
    await p.close();
  }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(sizes.length, 4);

  let offset = 6 + 16 * sizes.length;
  const entries = sizes.map((size, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size, 0); // width
    e.writeUInt8(size, 1); // height
    e.writeUInt8(0, 2);    // palette colours
    e.writeUInt8(0, 3);    // reserved
    e.writeUInt16LE(1, 4);  // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    return e;
  });

  writeFileSync(out, Buffer.concat([header, ...entries, ...pngs]));
  console.log(`favicon.ico  ${sizes.join("/")}`);
}

await icon(192, `${ROOT}/icons/icon-192.png`);
await icon(512, `${ROOT}/icons/icon-512.png`);
await appleIcon(180, `${ROOT}/icons/apple-touch-icon.png`);

// Device pixel sizes, matching the media queries in app/layout.tsx.
await splash(1179, 2556, `${ROOT}/splash/iphone15.png`);
await splash(1284, 2778, `${ROOT}/splash/iphone14plus.png`);
await splash(1170, 2532, `${ROOT}/splash/iphone13.png`);
await splash(1125, 2436, `${ROOT}/splash/iphonex.png`);
await splash(1242, 2208, `${ROOT}/splash/iphone8plus.png`);
await splash(750, 1334, `${ROOT}/splash/iphone8.png`);

await favicon(join(ROOT, "..", "app", "favicon.ico"));

await b.close();
