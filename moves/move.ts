import { promises as fs } from "node:fs";
import path from "node:path";
import bar from "../bar";

/**
 * Moves all duplicate images (lower score in each group) to a destination folder.
 * Keeps the image with the highest score in place.
 *
 * @param groups Array of image groups, each group containing image paths and scores
 * @param dest Destination folder where duplicates should be moved
 */
export async function moveDups(
	groups: ScoreGroup[],
	dest: string,
): Promise<void> {
	await fs.mkdir(dest, { recursive: true });
	groups = groups.map((g) => g.filter((ele) => !ele.keep));
	const total = groups.reduce((a, c) => a + c.length, 0);
	const b = bar.start(0, total, {
		task: "Moving duplicates",
		detail: "Staring...",
	});
	for (const group of groups) {
		for (const img of group) {
			b.increment(1, { detail: path.basename(img.path) });
			const srcPath = path.resolve(img.path);
			const destPath = path.resolve(dest, path.basename(img.path));

			try {
				await fs.rename(srcPath, destPath);
			} catch (err: any) {
				if (err.code === "EXDEV") {
					// Handle cross-device move (copy then delete)
					await fs.copyFile(srcPath, destPath);
					await fs.unlink(srcPath);
				} else {
					console.error(`Failed to move ${srcPath}:`, err);
				}
			}
		}
	}
	b.complete();
}
