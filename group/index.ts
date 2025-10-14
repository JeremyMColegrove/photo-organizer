import exifr from "exifr";
import fs from "node:fs";
import phash from "sharp-phash";
import bar from "../bar";
import { cosineSimilarity, getClipEmbedding } from "./clip";

type Image = {
	path: string;
	hash: string | null;
	time: number | null;
	clip: number[];
};

export async function groupPhotos(
	files: FileList,
	options: GroupOptions = {},
): Promise<ImageGroup[]> {
	const phashThreshold = options.phash ?? 0.85;
	const secondsSeparated = options.secondsSeparated ?? 10;
	const cosineSimilarityThreshold = options.cosineSimilarityThreshold ?? 0.8;
	const cosineMaxMinutes = options.cosineMaxMinutes ?? 60 * 24; // same day
	const photos = await buildPhotosFromFiles(files);

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

	const b = bar.start(0, photos.length, { task: "Grouping photos" });
	for (const seed of photos) {
		b.increment();
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

		// Include all groups, even singletons, so scoring can reflect total photos
		groups.push(group.map((g) => ({ path: g.path })));
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

async function safePhash(file: string): Promise<string | null> {
	try {
		return await phash(file);
	} catch {
		return null;
	}
}

async function getCaptureTime(file: string): Promise<number | null> {
	try {
		const exif = await exifr.parse(file, ["DateTimeOriginal", "CreateDate"]);
		const date: Date | undefined =
			(exif as any)?.DateTimeOriginal || (exif as any)?.CreateDate;
		return date ? date.getTime() : null;
	} catch {
		const stats = fs.statSync(file);
		return stats.mtimeMs;
	}
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

async function buildPhotosFromFiles(files: FileList): Promise<Image[]> {
	const photos: Image[] = [];
	const b = bar.start(0, files.length, { task: "Clipping images" });
	for (const file of files) {
		b.increment();
		const hash = await safePhash(file);
		const time = await getCaptureTime(file);
		const clip = await getClipEmbedding(file);
		photos.push({ path: file, hash, time, clip });
	}
	b.complete();
	return photos;
}
