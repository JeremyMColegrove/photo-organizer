// src/vision.ts
import fs from "node:fs/promises";

export const isWindows = process.platform === "win32";
let modelsLoaded = false;

let faceapi: typeof import("@vladmandic/face-api") | null = null;
let tf: typeof import("@tensorflow/tfjs-node") | null = null;

// Allow opting out via CLI flag regardless of OS
export const skipFacialRecognition = (() => {
	// Accept forms like:
	// --skip-facial-recognition
	// --skip-facial-recognition=true|false
	// (yargs still leaves raw args in process.argv)
	for (const a of process.argv) {
		if (a === "--skip-facial-recognition") return true;
		if (a.startsWith("--skip-facial-recognition=")) {
			const v = a.split("=", 2)[1]?.toLowerCase();
			if (v === "1" || v === "true" || v === "yes") return true;
			if (v === "0" || v === "false" || v === "no") return false;
			// If provided without a clear boolean, treat as enabled
			return true;
		}
	}
	return false;
})();

if (!skipFacialRecognition) {
	faceapi = await import("@vladmandic/face-api");
	tf = await import("@tensorflow/tfjs-node");
} else {
	console.log(
		"⚠️ --skip-facial-recognition set, skipping facial recognition libraries",
	);
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
