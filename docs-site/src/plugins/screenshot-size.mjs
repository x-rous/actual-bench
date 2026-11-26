// Show each screenshot at the size it was taken, not at the column's width.
//
// Screenshots are captured at 2x (SCALE in scripts/demo-capture.mjs) so they
// stay sharp on high-density screens and when zoomed. Left alone, a browser
// stretches every image to the full width of the text column, so a 400px dialog
// is drawn twice its real size and reads as a page of giant buttons. This caps
// each image at its width in CSS pixels; wide page shots still shrink to fit the
// column, and image zoom shows them full size.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const SCALE = 2;

/** A PNG's pixel width, from its IHDR chunk. */
function pngWidth(path) {
	const header = readFileSync(path).subarray(0, 24);
	if (header.toString('latin1', 1, 4) !== 'PNG') return null;
	return header.readUInt32BE(16);
}

function walk(node, visit) {
	visit(node);
	for (const child of node.children ?? []) walk(child, visit);
}

export function remarkScreenshotSize() {
	return (tree, file) => {
		const from = file.path ?? file.history?.[0];
		if (!from) return;
		walk(tree, (node) => {
			if (node.type !== 'image' || !node.url.includes('assets/screenshots/')) return;
			let width;
			try {
				width = pngWidth(resolve(dirname(from), node.url));
			} catch {
				return; // a missing file is Astro's error to report, not this plugin's
			}
			if (!width) return;
			node.data ??= {};
			node.data.hProperties = {
				...node.data.hProperties,
				style: `max-width: min(100%, ${Math.round(width / SCALE)}px)`,
			};
		});
	};
}
