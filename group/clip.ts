import {
	type ImageFeatureExtractionPipeline,
	pipeline,
} from "@huggingface/transformers";

// Disable telemetry (optional)
// env.allowRemoteModels = true;
// env.useBrowserCache = false;

// Singleton pipeline instance (auto-cached after first load)
let imageEmbedder: ImageFeatureExtractionPipeline | null = null;

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

/**
 * Computes cosine similarity between two embeddings.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
	const dot = a.reduce((sum, v, i) => sum + v * b[i]!, 0);
	const normA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
	const normB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
	return dot / (normA * normB);
}
