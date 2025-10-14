import path from "node:path";
import bar from "../bar";
import { cosineSimilarity, type Image } from "./clip";

export async function groupPhotos(
	photos: Image[],
	options: GroupOptions = {},
): Promise<ImageGroup[]> {
	const phashThreshold = options.phash ?? 0.85;
	const secondsSeparated = options.secondsSeparated ?? 10;
	const cosineSimilarityThreshold = options.cosineSimilarityThreshold ?? 0.8;
	const cosineMaxMinutes = options.cosineMaxMinutes ?? 60 * 24; // same day

	const groups = groupPhotosTransitive(photos, {
		cosineSimilarityThreshold,
		secondsSeparated,
		phashThreshold,
		cosineMaxMinutes,
	});
	return groups;
}

/**
 * Builds groups by taking the transitive closure of the similarity relation.
 * (i.e., if A~B and B~C, the group becomes {A,B,C} even if A!~C directly)
 */
export function groupPhotosTransitive(
	photos: Image[],
	{
		phashThreshold,
		secondsSeparated,
		cosineSimilarityThreshold,
		cosineMaxMinutes,
	}: {
		phashThreshold: number;
		secondsSeparated: number;
		cosineSimilarityThreshold: number;
		cosineMaxMinutes: number;
	},
): ImageGroup[] {
	const used = new Set<string>();
	const groups: ImageGroup[] = [];

	const b = bar.start(0, photos.length, {
		task: "Grouping photos",
		detail: "Starting...",
	});
	for (const seed of photos) {
		b.increment(1, { detail: path.basename(seed.path) });
		if (used.has(seed.path)) continue;
		// Start a new component with a flood-fill
		const group: Image[] = [];
		const queue: Image[] = [seed];
		used.add(seed.path);

		while (queue.length) {
			const current = queue.pop()!;
			group.push(current);

			for (const other of photos) {
				if (used.has(other.path) || other.path === current.path) continue;

				if (
					areLinked(
						current,
						other,
						phashThreshold,
						secondsSeparated,
						cosineSimilarityThreshold,
						cosineMaxMinutes,
					)
				) {
					used.add(other.path);
					queue.push(other);
				}
			}
		}

		if (group.length > 1) {
			// Include all groups, even singletons, so scoring can reflect total photos
			groups.push(group.map((g) => ({ path: g.path })));
		}
	}
	b.complete();
	return groups;
}

/* ---------- helpers ---------- */

function areLinked(
	a: Image,
	b: Image,
	phashThreshold: number,
	secondsSeparated: number,
	cosineSimilarityThreshold: number,
	cosineMaxMinutes: number,
): boolean {
	const similar =
		a.hash && b.hash
			? phashSimilarity(a.hash, b.hash) >= phashThreshold
			: false;

	const cosineWithinTime =
		a.time && b.time
			? Math.abs(a.time - b.time) <= cosineMaxMinutes * 60000
			: true;

	const closeInTime =
		typeof a.time === "number" && typeof b.time === "number"
			? Math.abs(a.time - b.time) <= secondsSeparated * 1000
			: false;

	const cos = cosineSimilarity(a.clip, b.clip);

	// Log if you want to debug:
	// console.log(
	// 	a.path,
	// 	b.path,
	// 	similar,
	// 	closeInTime,
	// 	cos,
	// 	Math.abs((a.time ?? 0) - (b.time ?? 0)),
	// 	cosineMaxMinutes * 60000,
	// );

	return (
		similar ||
		closeInTime ||
		(cos > cosineSimilarityThreshold && !!cosineWithinTime)
	);
}

function phashSimilarity(a: string, b: string): number {
	const A = BigInt("0x" + a);
	const B = BigInt("0x" + b);
	let x = A ^ B;
	let bits = 0;
	while (x) {
		x &= x - 1n;
		bits++;
	}
	return 1 - bits / 64;
}
