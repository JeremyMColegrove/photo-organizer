import {
	type FeatureExtractionPipeline,
	pipeline,
} from "@huggingface/transformers";

// Disable telemetry (optional)
// env.allowRemoteModels = true;
// env.useBrowserCache = false;

// Singleton pipeline instance (auto-cached after first load)
const imageEmbedder: FeatureExtractionPipeline | null = null;

/**
 * Loads CLIP model (lazy)
 */
// async function loadModel() {
// 	if (!imageEmbedder) {
// 		imageEmbedder = await pipeline(
// 			"feature-extraction",
// 			"Xenova/clip-vit-base-patch32",
// 			{ dtype: "q4", device: "cpu" },
// 		);
// 	}
// 	return imageEmbedder;
// }

/**
 * Generates a CLIP embedding for the given image path.
 * @param imagePath Absolute or relative path to image
 * @returns Promise<number[]> vector embedding
 */
export async function getClipEmbedding(imagePath: string): Promise<number[]> {
	// const bytes = fs.readFileSync(imagePath);
	const extractor = await pipeline(
		"image-feature-extraction",
		"xenova/clip-vit-base-patch32",
		{ dtype: "auto", device: "auto" },
	);

	const result = await extractor(imagePath, {
		//@ts-expect-error
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
