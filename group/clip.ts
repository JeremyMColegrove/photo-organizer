import {
	type ImageFeatureExtractionPipeline,
	pipeline,
	RawImage,
	type ZeroShotImageClassificationOutput,
	type ZeroShotImageClassificationPipeline,
} from "@huggingface/transformers";
import exifr from "exifr";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import phash from "sharp-phash";
import bar from "../bar";

// Disable telemetry (optional)
// env.allowRemoteModels = true;
// env.useBrowserCache = false;

// Singleton pipeline instance (auto-cached after first load)
let imageEmbedder: ImageFeatureExtractionPipeline | null = null;
let textEmbedder: ZeroShotImageClassificationPipeline | null = null;
/**
 * Loads CLIP model (lazy)
 */
async function loadModel() {
	if (!imageEmbedder) {
		imageEmbedder = await pipeline(
			"image-feature-extraction",
			"xenova/clip-vit-base-patch32",
			{ dtype: "auto", device: "auto" },
		);
	}
	return imageEmbedder;
}

/**
 * Loads CLIP model (lazy)
 */
async function loadClassifierModel() {
	if (!textEmbedder) {
		textEmbedder = await pipeline(
			"zero-shot-image-classification",
			"Xenova/siglip-large-patch16-256",
			{ dtype: "auto", device: "auto" },
		);
	}
	return textEmbedder;
}

/**
 * Generates a CLIP embedding for the given image path.
 * @param imagePath Absolute or relative path to image
 * @returns Promise<number[]> vector embedding
 */
export async function getClipEmbedding(imagePath: string): Promise<number[]> {
	// const bytes = fs.readFileSync(imagePath);
	const extractor = await loadModel();
	if (!extractor) return [];

	const result = await extractor(imagePath, {
		//@ts-expect-error idk man
		pooling: "mean",
		normalize: true,
	});

	return Array.from(result.data as Float32Array);
}

export async function getClassifierScore(
	keywords: string[],
	imagePath: string,
): Promise<ZeroShotImageClassificationOutput | null> {
	// Lazily load model — we can reuse imageEmbedder (it’s same architecture)
	const classifier = await loadClassifierModel();
	if (!classifier) return null;

	// const img = await RawImage.read(imagePath);
	// use sharp to convert to better format (jpg)
	const buffer = await sharp(imagePath)
		.rotate() // honor EXIF orientation
		.toColorspace("srgb") // models are trained in sRGB
		.removeAlpha() // or .flatten({ background: "#fff" }) if you want white bg
		.resize({
			width: 224,
			height: 224,
			fit: "cover",
			position: "attention", // auto-crop toward salient region (or "entropy")
			withoutEnlargement: true,
			fastShrinkOnLoad: true,
		})
		.jpeg({
			quality: 92, // keep artifacts low for embeddings
			mozjpeg: true, // better psychovisually
			chromaSubsampling: "4:4:4", // preserve color detail (avoid 4:2:0 smearing)
			trellisQuantisation: true,
			overshootDeringing: true,
			optimizeScans: true,
			progressive: true,
		})
		.toBuffer();

	const raw = await RawImage.fromBlob(new Blob([buffer]));
	const result = await classifier(raw, keywords, {
		hypothesis_template: "a photo of {}",
	});
	return result.flat().at(0) ?? null;
	// return res.reduce((a, c) => (c.score > a.score ? c : a));
}

/**
 * Computes cosine similarity between two embeddings.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
	const dot = a.reduce((sum, v, i) => sum + v * b[i]!, 0);
	const normA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
	const normB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
	return dot / (normA * normB);
}

export type Image = {
	path: string;
	hash: string | null;
	time: number | null;
	clip: number[];
};

export async function buildPhotosFromFiles(files: FileList): Promise<Image[]> {
	const photos: Image[] = [];
	const b = bar.start(0, files.length, { task: "Clipping images" });
	for (const file of files) {
		b.increment(0, { detail: path.basename(file) });
		const hash = await safePhash(file);
		const time = await getCaptureTime(file);
		const clip = await getClipEmbedding(file);
		photos.push({ path: file, hash, time, clip });
		b.increment();
	}
	b.complete();
	return photos;
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
		const date: Date | undefined = exif?.DateTimeOriginal || exif?.CreateDate;
		return date ? date.getTime() : null;
	} catch {
		const stats = fs.statSync(file);
		return stats.mtimeMs;
	}
}
