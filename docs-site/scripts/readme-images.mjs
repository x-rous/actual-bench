/**
 * Build the README's copies of the documentation screenshots.
 *
 *   node docs-site/scripts/readme-images.mjs
 *
 * The screenshots are captured at 5x so they stay sharp when a reader zooms
 * into them on the documentation site. That is the wrong image to put in a
 * README: GitHub serves the file happily, but the browser still has to decode
 * it, and seven 50-megapixel PNGs come to well over a gigabyte of bitmap on one
 * page. Past a certain point the browser gives up and paints nothing, which is
 * exactly what happened - the files were fine, the page just could not draw
 * them.
 *
 * So the README gets its own copies: same images, sized for a page that shows
 * them at a few hundred pixels wide. Regenerate them whenever the screenshots
 * are retaken.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const shots = join(repo, "docs-site", "src", "assets", "screenshots");
const out = join(repo, "docs", "readme-images");

/**
 * Wide enough to stay crisp on a high-density screen: GitHub renders a README
 * at roughly 900px, and half that in the two-column tables.
 */
const WIDTH = 1600;

const IMAGES = [
  "user-guide/budget-envelope.png",
  "user-guide/rule-diagnostics.png",
  "user-guide/payee-cleanup.png",
  "user-guide/bank-reconciliation.png",
  "user-guide/backups.png",
  "user-guide/actualql.png",
  "user-guide/automations.png",
];

await mkdir(out, { recursive: true });

let total = 0;
for (const image of IMAGES) {
  const name = image.split("/").pop();
  const source = await readFile(join(shots, image));
  const resized = await sharp(source)
    .resize({ width: WIDTH, withoutEnlargement: true })
    // Same maximum-effort encoding the captures use: lossless, and the smaller
    // file is the whole point here.
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer();
  await writeFile(join(out, name), resized);
  total += resized.length;
  const { width, height } = await sharp(resized).metadata();
  console.log(`  ${name.padEnd(28)} ${width}x${height}  ${(resized.length / 1024).toFixed(0)}KB`);
}
console.log(`\n${IMAGES.length} images, ${(total / 1024 / 1024).toFixed(1)}MB total`);
