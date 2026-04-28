// Rasterise build/icon.svg into a multi-resolution Windows .ico.
//
// Sizes follow the standard Windows ICO progression so File Explorer / taskbar /
// dialogs each pick the closest match without bilinear softness:
//   16, 24, 32, 48, 64, 128, 256
//
// Run via:  node scripts/build-icon.mjs   (or `npm run build:icon`)

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SVG_PATH = resolve(ROOT, "build/icon.svg");
const ICO_PATH = resolve(ROOT, "build/icon.ico");
const PNG_256_PATH = resolve(ROOT, "build/icon.png");

const SIZES = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  const svg = await readFile(SVG_PATH);

  // Rasterise SVG at each target size, density chosen so libvips renders
  // crisply rather than upscaling a small bitmap.
  const pngBuffers = await Promise.all(
    SIZES.map((size) =>
      sharp(svg, { density: Math.max(72, size * 2) })
        .resize(size, size)
        .png({ compressionLevel: 9 })
        .toBuffer()
    )
  );

  // Pack all sizes into a single multi-image ICO.
  const ico = await pngToIco(pngBuffers);
  await mkdir(dirname(ICO_PATH), { recursive: true });
  await writeFile(ICO_PATH, ico);

  // Also emit a 256×256 PNG for non-Windows tooling (DMG / linux) and previews.
  await writeFile(PNG_256_PATH, pngBuffers[pngBuffers.length - 1]);

  console.log(`✓ build/icon.ico  (${SIZES.join(", ")} px, ${ico.length} bytes)`);
  console.log(`✓ build/icon.png  (256×256, ${pngBuffers[pngBuffers.length - 1].length} bytes)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
