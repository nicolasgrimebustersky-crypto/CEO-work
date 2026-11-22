/**
 * Regenerates every app icon, launch image and the in-app logo from the
 * artwork in assets/: logo-source.png is the full Solid Acre lockup (shield
 * and wordmark), mark-source.png is the shield alone, for the square icons
 * where a wordmark would be unreadable. Both are transparent PNGs in the
 * reversed colourway — white where the printed logo is navy — because every
 * place they land is navy.
 *
 *   npm i --no-save playwright && node scripts/generate-icons.mjs
 *
 * One source of truth: replace the source file, run this, commit what changes.
 * Doing it by hand across a dozen files is how an icon set drifts — you update
 * the ones you happen to look at and the 8-plus splash keeps last year's mark.
 *
 * The sources live in assets/ rather than public/ because they are
 * print-resolution PNGs, and everything under public/ is served to browsers.
 * The derivative this writes to public/logo.png is a fraction of the size, and
 * is the only one the app itself ever loads.
 *
 * Rendering goes through a real browser rather than an image library: the
 * artwork needs cropping, scaling and re-encoding, and a browser does all
 * three without adding a dependency this project would otherwise never need.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "public");

/** The app's canvas navy (--color-canvas), behind every icon and splash. */
const CANVAS = "#071120";

const dataUrl = (file) =>
  `data:image/png;base64,${readFileSync(join(ROOT, "assets", file)).toString("base64")}`;
const LOCKUP = dataUrl("logo-source.png");
const MARK = dataUrl("mark-source.png");

// CHROMIUM_PATH lets this run against a browser already on the machine.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});

/**
 * The artwork's bounding box, so the icons are the mark rather than the mark
 * adrift in a field of black. Measured rather than hardcoded: a replacement
 * logo will not have the same margins.
 */
async function measure(sourceUrl) {
  const page = await browser.newPage();
  await page.setContent(`<img id="i" src="${sourceUrl}">`);
  await page.waitForFunction(() => document.getElementById("i")?.complete);
  const box = await page.evaluate(() => {
    const img = document.getElementById("i");
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        // Anything meaningfully opaque is artwork.
        if (data[i + 3] > 20) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return { minX, minY, maxX, maxY, width, height };
  });
  await page.close();
  return box;
}

async function artwork(sourceUrl) {
  const box = await measure(sourceUrl);
  const artW = box.maxX - box.minX + 1;
  const artH = box.maxY - box.minY + 1;
  console.log(`artwork ${artW}x${artH} at ${box.minX},${box.minY} of ${box.width}x${box.height}`);
  return { sourceUrl, box, artW, artH };
}
const lockup = await artwork(LOCKUP);
const mark = await artwork(MARK);

/**
 * The cropped artwork centred in a box, on the canvas navy.
 * `inset` is the share of the tile left as breathing room — iOS rounds the
 * corners off an icon, and a wordmark that runs to the edge loses its last
 * letter to the mask.
 */
function pageHtml(art, width, height, inset, background = CANVAS) {
  const { sourceUrl, box, artW, artH } = art;
  const scale = Math.min((width * (1 - inset * 2)) / artW, (height * (1 - inset * 2)) / artH);
  const drawW = artW * scale;
  const drawH = artH * scale;

  return `<body style="margin:0;background:${background};width:${width}px;height:${height}px;overflow:hidden">
    <div style="position:absolute;left:${(width - drawW) / 2}px;top:${(height - drawH) / 2}px;
                width:${drawW}px;height:${drawH}px;overflow:hidden">
      <img src="${sourceUrl}" style="position:absolute;
           left:${-box.minX * scale}px;top:${-box.minY * scale}px;
           width:${box.width * scale}px;height:${box.height * scale}px">
    </div>
  </body>`;
}

async function shoot(art, width, height, inset, out, jpegQuality, background) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(pageHtml(art, width, height, inset, background));
  await page.waitForTimeout(160);
  const buffer = await page.screenshot(
    jpegQuality ? { type: "jpeg", quality: jpegQuality } : undefined,
  );
  writeFileSync(out, buffer);
  await page.close();
  console.log(
    `${out.slice(ROOT.length + 1)}  ${width}x${height}  ${Math.round(buffer.length / 1024)}KB`,
  );
}

/* ------------------------------------------------------------------ icons */

// The shield alone, inset so the rounded mask iOS applies does not clip it.
// The maskable icon gets more room: Android may crop it to a circle.
await shoot(mark, 192, 192, 0.12, join(PUBLIC, "icons", "icon-192.png"));
await shoot(mark, 512, 512, 0.12, join(PUBLIC, "icons", "icon-512.png"));
await shoot(mark, 512, 512, 0.2, join(PUBLIC, "icons", "icon-maskable-512.png"));
await shoot(mark, 180, 180, 0.12, join(PUBLIC, "icons", "apple-touch-icon.png"));

/* ------------------------------------------------ the in-app derivatives */

/**
 * The lockup cropped to its artwork and scaled down, still transparent, so it
 * sits on a panel instead of inside a box. The source already carries alpha,
 * so this is a crop and a resize and nothing else.
 *
 * Drawn at 2x the largest place it appears, which is 168px in the drawer.
 */
async function transparentLogo(art, width, out) {
  const { sourceUrl, box, artW, artH } = art;
  const height = Math.round((width * artH) / artW);
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent("<body></body>");

  const dataUrl = await page.evaluate(
    async ({ w, h, src, box }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas
        .getContext("2d")
        .drawImage(img, box.minX, box.minY, box.maxX - box.minX + 1, box.maxY - box.minY + 1, 0, 0, w, h);
      return canvas.toDataURL("image/png");
    },
    { w: width, h: height, src: sourceUrl, box },
  );

  const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
  writeFileSync(out, bytes);
  await page.close();
  console.log(`${out.slice(ROOT.length + 1)}  ${width}x${height}  ${Math.round(bytes.length / 1024)}KB  (alpha)`);
}

// What the app itself shows: drawer, document preview. Transparent, so it
// belongs to whatever surface it lands on.
await transparentLogo(lockup, 420, join(PUBLIC, "logo.png"));

/* ------------------------------------------------------ the PDF's version */

/**
 * What the drawer, the preview header and the PDF all use.
 *
 * JPEG, not PNG, for two reasons. The artwork is a soft-shaded render on a
 * solid navy field — exactly what PNG is worst at, and the lossless version
 * of this file came out half a megabyte for something displayed at forty
 * pixels. And PDF can carry JPEG data verbatim through /DCTDecode, so the
 * same file the app shows is the one embedded in the customer's invoice, with
 * no decoding or re-encoding in between.
 */
// On the navy the PDF's header band is filled with (BRAND.ink): same value.
await shoot(
  lockup,
  640,
  Math.round((640 * lockup.artH) / lockup.artW),
  0,
  join(PUBLIC, "logo.jpg"),
  84,
  "#0b2341",
);

/* --------------------------------------------------------------- splashes */

// Device pixel sizes, matching the media queries in app/layout.tsx.
for (const [w, h, name] of [
  [1179, 2556, "iphone15"],
  [1284, 2778, "iphone14plus"],
  [1170, 2532, "iphone13"],
  [1125, 2436, "iphonex"],
  [1242, 2208, "iphone8plus"],
  [750, 1334, "iphone8"],
]) {
  await shoot(lockup, w, h, 0.28, join(PUBLIC, "splash", `${name}.png`));
}

/* ---------------------------------------------------------------- favicon */

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
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(pageHtml(mark, size, size, 0.04));
    await page.waitForTimeout(120);
    pngs.push(await page.screenshot());
    await page.close();
  }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // 1 = icon
  header.writeUInt16LE(sizes.length, 4);

  let offset = 6 + 16 * sizes.length;
  const entries = sizes.map((size, i) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size, 0); // width
    entry.writeUInt8(size, 1); // height
    entry.writeUInt8(0, 2); // palette colours
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(pngs[i].length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    return entry;
  });

  writeFileSync(out, Buffer.concat([header, ...entries, ...pngs]));
  console.log(`app/favicon.ico  ${sizes.join("/")}`);
}

await favicon(join(ROOT, "app", "favicon.ico"));

await browser.close();
