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
 * at roughly 900px, and half that in the two-column tables. A shot can ask for
 * less - the connect form is a tall, narrow card, and 1600px of it would run
 * off the bottom of the page.
 */
const WIDTH = 1600;

const IMAGES = [
  { path: "user-guide/budget-envelope.png" },
  { path: "user-guide/rule-diagnostics.png" },
  { path: "user-guide/payee-cleanup.png" },
  { path: "user-guide/bank-reconciliation.png" },
  { path: "user-guide/backups.png" },
  { path: "user-guide/actualql.png" },
  { path: "user-guide/automations.png" },
  { path: "getting-started/connect.png", width: 720 },
];

await mkdir(out, { recursive: true });

let total = 0;
for (const image of IMAGES) {
  const name = image.path.split("/").pop();
  const source = await readFile(join(shots, image.path));
  const resized = await sharp(source)
    .resize({ width: image.width ?? WIDTH, withoutEnlargement: true })
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
