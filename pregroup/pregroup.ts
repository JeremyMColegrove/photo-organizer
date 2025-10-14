import path from "node:path";
import bar from "../bar";
import { getClassifierScore, type Image } from "../group/clip";

type PreGroupOptions = {
	/** Minimum score (0..1) to consider a keyword a match */
	threshold?: number;
	/** Model to use for zero-shot image classification */
	model?: string;
	/** Optional hypothesis template for CLIP */
	template?: string;
};

export default async function preGroupPhotos(
	images: Image[],
	keywords: string[],
	options: PreGroupOptions = {},
): Promise<ImageGroup[]> {
	const labels = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];
	if (images.length === 0 || labels.length === 0) return [];

	const threshold = options.threshold ?? 0.35;

	// Prepare result: one group per label, same order as `labels`
	const groups = new Map<string, Image[]>();

	const b = bar.start(0, images.length, { task: "Classifying (pregroup)" });

	for (const img of images) {
		b.increment(0, { detail: path.basename(img.path) });

		try {
			const best = await getClassifierScore(labels, img.path);

			if (!best) {
				b.increment();
				continue;
			}

			// Assign image to exactly one group: the best label, if above threshold
			if (best.score > threshold) {
				// todo keep track of groups using best.label, use label to assign to right group
				if (groups.has(best.label)) {
					groups.set(best.label, [...groups.get(best.label)!, img]);
				} else {
					groups.set(best.label, [img]);
				}
			}
		} catch (e) {
			// skip on error
			console.error(e);
		}

		b.increment();
	}

	b.complete({ task: "Classifying (pregroup)" });
	return Array.from(groups.values());
}
