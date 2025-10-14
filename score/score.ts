import type { Tensor3D } from "@tensorflow/tfjs-node";
import type { Point } from "@vladmandic/face-api";
import path from "node:path";
import sharp from "sharp";
import bar from "../bar";
import { ensureFaceApi, faceapi, skipFacialRecognition, tf } from "./vision";

/** Weights for composite score */
const WEIGHTS: Readonly<ScoreBreakdown> = {
	brightness: 0.05, // correct exposure contributes modestly
	contrast: 0.1, // too flat or too harsh penalized
	sharpness: 0.1, // critical for overall clarity and perceived quality
	facePresence: 0.15, // reward having a recognizable face
	eyesOpen: 0.15, // important in portraits/selfies
	smiling: 0.45, // slight boost for expressive/smiling subjects
};

function clamp01(x: number): number {
	return Math.max(0, Math.min(1, x));
}

function weightedSum(b: ScoreBreakdown): number {
	return clamp01(
		b.brightness * WEIGHTS.brightness +
			b.contrast * WEIGHTS.contrast +
			b.sharpness * WEIGHTS.sharpness +
			b.facePresence * WEIGHTS.facePresence +
			b.eyesOpen * WEIGHTS.eyesOpen +
			b.smiling * WEIGHTS.smiling,
	);
}
export async function computeBrightnessContrast(
	buffer: Buffer,
): Promise<{ brightness: number; contrast: number }> {
	// Downscale for performance (keep aspect, max dim 256), greyscale → 1 channel raw
	const MAX_DIM = 256;

	const img = sharp(buffer, { failOn: "none" }).rotate(); // auto-orient
	const meta = await img.metadata();
	const { width = 0, height = 0 } = meta;

	// Handle weird/empty images
	if (!width || !height) {
		return { brightness: 0, contrast: 0 };
	}

	const scale =
		Math.max(width, height) > MAX_DIM ? MAX_DIM / Math.max(width, height) : 1;
	const targetW = Math.max(1, Math.round(width * scale));
	const targetH = Math.max(1, Math.round(height * scale));

	const { data, info } = await img
		.resize(targetW, targetH, { fit: "inside" })
		.removeAlpha()
		.toColourspace("srgb")
		.raw()
		.toBuffer({ resolveWithObject: true });

	// Compute luminance per pixel from RGB (sRGB Rec.709 luma)
	const pixels = info.width * info.height;
	const channels = info.channels; // likely 3 (RGB) after removeAlpha
	if (channels < 3) {
		// Fallback if pipeline changes
		return { brightness: 0, contrast: 0 };
	}

	// Convert to luminance in [0,1] using ITU-R BT.709 coefficients
	// Y = 0.2126 R + 0.7152 G + 0.0722 B   (on 0..255)
	let sum = 0;
	let sumSq = 0;

	for (let i = 0; i < data.length; i += channels) {
		const r = data[i];
		const g = data[i + 1];
		const b = data[i + 2];
		const y = (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255; // 0..1

		sum += y;
		sumSq += y * y;
	}

	const mean = sum / pixels; // 0..1
	const variance = clamp01(sumSq / pixels - mean * mean); // numeric safety
	const stddev = Math.sqrt(variance); // typical natural images ~0.10–0.25

	// Normalize RMS contrast: choose 0.5 (i.e., stdev=0.5) as "full" contrast, then clamp
	const contrast = clamp01(stddev / 0.5);

	return {
		brightness: clamp01(mean),
		contrast,
	};
}
/**
 * Sharpness score in [0,1] using Variance-of-Laplacian (edge energy).
 * - 0  = very blurry, 1 = very sharp
 * - Lightweight: uses only `sharp`, no native OpenCV dependency.
 */
export async function computeSharpness(buffer: Buffer): Promise<number> {
	const MAX_DIM = 256;

	const img = sharp(buffer, { failOn: "none" }).rotate(); // auto-orient
	const meta = await img.metadata();
	const { width = 0, height = 0 } = meta;
	if (!width || !height) return 0;

	const scale =
		Math.max(width, height) > MAX_DIM ? MAX_DIM / Math.max(width, height) : 1;
	const w = Math.max(1, Math.round(width * scale));
	const h = Math.max(1, Math.round(height * scale));

	// Grayscale, raw bytes (1 channel)
	const { data } = await img
		.resize(w, h, { fit: "inside" })
		.removeAlpha()
		.greyscale()
		.raw()
		.toBuffer({ resolveWithObject: true });

	// Laplacian kernel (4-neighbor):
	// [ 0,  1,  0
	//   1, -4,  1
	//   0,  1,  0 ]
	// Work on normalized [0,1] pixels for stable scaling.
	const get = (x: number, y: number) => data[y * w + x]! / 255;

	let sumSq = 0;
	let count = 0;

	for (let y = 1; y < h - 1; y++) {
		for (let x = 1; x < w - 1; x++) {
			const c = get(x, y);
			const L =
				get(x, y - 1) + get(x - 1, y) + get(x + 1, y) + get(x, y + 1) - 4 * c;

			sumSq += L * L; // edge energy
			count++;
		}
	}

	if (!count) return 0;
	const energy = sumSq / count; // average Laplacian energy, ~0..(~1)

	// Map energy -> [0,1] with a smooth saturating curve.
	// k controls where the score feels "mid". Adjust if needed.
	const k = 0.01; // good default for 8-bit images normalized to [0,1]
	const sharpness = energy / (energy + k);

	return clamp01(sharpness);
}
/** Eye Aspect Ratio (EAR) from 6 eye landmarks (68-pt model). */
function ear(pts: Array<Point>): number {
	if (!pts || pts.length !== 6) return 0;
	const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
	const [p1, p2, p3, p4, p5, p6] = pts;
	const num = dist(p2!, p6!) + dist(p3!, p5!);
	const den = 2 * dist(p1!, p4!);
	return den > 0 ? num / den : 0;
}

/** Map EAR → eyesOpen score (0..1) with threshold & taper. */
function eyesOpenScore(lEAR: number, rEAR: number): number {
	const avg = (lEAR + rEAR) / 2;
	// Typical closed ~0.15–0.22, open ~0.25–0.35
	const t0 = 0.2; // fully closed
	const t1 = 0.28; // confidently open
	if (avg <= t0) return 0;
	if (avg >= t1) return 1;
	return (avg - t0) / (t1 - t0);
}

/** Use face-api to detect face, landmarks (for eyes), and expressions (for smile). */
export async function computeFaceSignals(
	buffer: Buffer,
): Promise<{ facePresence: number; eyesOpen: number; smiling: number }> {
	if (skipFacialRecognition) {
		return { facePresence: 0, eyesOpen: 0, smiling: 0 };
	}

	// Decode to tensor (RGB)
	const fa = faceapi;
	const tfn = tf;
	if (!fa || !tfn) {
		return { facePresence: 0, eyesOpen: 0, smiling: 0 };
	}
	const tensor = tfn.node.decodeImage(buffer, 3) as Tensor3D;
	try {
		const detections = await fa
			.detectAllFaces(
				tensor,
				new fa.SsdMobilenetv1Options({ minConfidence: 0.3 }),
			)
			.withFaceLandmarks()
			.withFaceExpressions();

		if (!detections.length) {
			return { facePresence: 0, eyesOpen: 0, smiling: 0 };
		}

		// Pick the best (highest confidence); if tie, pick largest area.
		const picked = detections.reduce((a, b) => {
			const as = a.detection.score ?? 0;
			const bs = b.detection.score ?? 0;
			if (as !== bs) return as > bs ? a : b;
			const aa = a.detection.box.width * a.detection.box.height;
			const ba = b.detection.box.width * b.detection.box.height;
			return aa >= ba ? a : b;
		});

		// --- facePresence: use detector score (0–1), optionally blended with relative area
		const score = clamp01(picked.detection.score ?? 0);
		// Relative area (helps down-weight tiny distant faces); uses input tensor dims.
		const [h, w] = tensor.shape.slice(0, 2);
		const areaRel = clamp01(
			(picked.detection.box.width * picked.detection.box.height) /
				(w! * h! + 1e-6),
		);
		// Blend: mostly confidence, with a light area prior
		const facePresence = clamp01(0.8 * score + 0.2 * Math.sqrt(areaRel));

		// --- eyesOpen via EAR
		const landmarks = picked.landmarks;
		const le = landmarks?.getLeftEye() ?? [];
		const re = landmarks?.getRightEye() ?? [];
		const lEAR = ear(le);
		const rEAR = ear(re);
		const eyesOpen = eyesOpenScore(lEAR, rEAR);

		// --- smiling from expression probabilities
		const happy = picked.expressions?.happy ?? 0;
		// Gentle emphasis on confident smiles
		const smiling = clamp01(happy ** 0.8);

		return { facePresence, eyesOpen, smiling };
	} finally {
		tensor.dispose();
	}
}

// ScoreEntry and ScoreGroup are now globally defined in global.d.ts

export async function scoreImages(
	group: ImageGroup[],
	modelsDir: string,
): Promise<ScoreGroup[]> {
	const ng = [];
	const total = group.reduce((a, c) => a + c.length, 0);
	const b = bar.start(0, total, {
		task: "Scoring images",
	});
	for (let i = 0; i < group.length; i++) {
		const g = group.at(i);
		if (!g) continue;
		const sg = await Promise.all(
			g.map(async (x) => {
				b.increment(0, { detail: path.basename(x.path) });
				const score = await scoreImage(x.path, modelsDir);
				// Increment per image so the bar reflects all images, not just groups
				b.increment();
				return {
					path: x.path,
					score: score,
					keep: false,
				};
			}),
		);
		ng.push(sg);
	}
	b.complete();

	return ng;
}

/** New scoring using sharp + face-api.js */
export async function scoreImage(
	filePath: string,
	modelsDir: string,
): Promise<ImageScore> {
	if (!skipFacialRecognition) {
		await ensureFaceApi(modelsDir);
	}

	const buffer = await sharp(filePath).toFormat("png").toBuffer();

	const { brightness, contrast } = await computeBrightnessContrast(buffer);
	const sharpness = await computeSharpness(buffer);

	const { facePresence, eyesOpen, smiling } = await computeFaceSignals(buffer);

	const breakdown: ScoreBreakdown = {
		brightness,
		contrast,
		sharpness,
		facePresence,
		eyesOpen,
		smiling,
	};
	const score = weightedSum(breakdown);

	return {
		path: path.resolve(filePath),
		score: score,
		breakdown,
	};
}
