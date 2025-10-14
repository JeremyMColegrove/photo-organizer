// src/vision.ts
import fs from "node:fs/promises";

export const isWindows = process.platform === "win32";
let modelsLoaded = false;

let faceapi: typeof import("@vladmandic/face-api") | null = null;
let tf: typeof import("@tensorflow/tfjs-node") | null = null;

if (!isWindows) {
	faceapi = await import("@vladmandic/face-api");
	tf = await import("@tensorflow/tfjs-node");
}

export async function ensureFaceApi(modelsDir: string): Promise<void> {
	if (modelsLoaded) return;

	// Validate models dir exists to keep errors readable
	const stat = await fs.stat(modelsDir).catch(() => null);
	if (!stat || !stat.isDirectory()) {
		throw new Error(`Models directory not found: ${modelsDir}`);
	}

	// Load the three nets we use
	await faceapi?.nets.ssdMobilenetv1.loadFromDisk(modelsDir);
	await faceapi?.nets.faceLandmark68Net.loadFromDisk(modelsDir);
	await faceapi?.nets.faceExpressionNet.loadFromDisk(modelsDir);

	modelsLoaded = true;
}

export { faceapi, tf };
