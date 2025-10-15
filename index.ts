import fg from "fast-glob";
import fs from "node:fs";
import path from "node:path";
import { hideBin } from "yargs/helpers";
import yargs from "yargs/yargs";
import { compressImagesInFolder } from "./compress/compress";
import { groupPhotos } from "./group";
import { buildPhotosFromFiles, setClipConfig } from "./group/clip";
import { moveDups } from "./moves/move";
import preGroupPhotos from "./pregroup/pregroup";
import { tagAndRenameFiles } from "./rename/rename";
import { reviewAllGroupsBun } from "./review/review";
import { scoreImages, setScoreConfig } from "./score/score";

const MODELS_DIR = path.resolve("models");

// Step type now provided globally via global.d.ts

const DEFAULT_EXTS = ["jpg", "jpeg", "png", "webp", "heic", "avif", "heif"];

function buildGlobPattern(exts: string[]): string {
	return `*.{${exts.join(",")}}`;
}

function saveLog(json: unknown, name: string) {
	fs.writeFileSync(name, JSON.stringify(json));
}

async function main() {
	const argv = await yargs(hideBin(process.argv))
		.option("path", {
			type: "string",
			demandOption: true,
			describe: "Path containing photos to organize",
		})
		.option("out", {
			type: "string",
			demandOption: true,
			default: "./duplicates",
			describe: "Path where unwanted photos are moved to",
		})
		.option("group", {
			type: "string",
			demandOption: false,
			default: "",
			describe:
				"List of comma-seperated keywords to pre-group by, e.g. screenshot,cat",
		})
		.option("ext", {
			type: "string",
			default: DEFAULT_EXTS.join(","),
			describe: "Comma-separated extensions to include (lowercase)",
		})
		.option("skip", {
			type: "string",
			default: "",
			describe: "Comma-separated steps to skip: group,move,rename,compress",
		})
		.option("skip-facial-recognition", {
			type: "boolean",
			default: false,
			describe:
				"Skips using facial recognition to determine best photo. This bypasses some libraries which can be problematic during installation.",
		})
		// Pregroup options
		.option("pregroup-threshold", {
			type: "number",
			default: 0.0001,
			describe: "Threshold (0..1) for pregroup keyword match",
		})
		// Grouping options
		.option("group-seconds-separated", {
			type: "number",
			default: 5,
			describe: "Max seconds apart to consider same group",
		})
		.option("group-phash", {
			type: "number",
			default: 0.8,
			describe: "pHash similarity threshold (0..1)",
		})
		.option("group-cosine-threshold", {
			type: "number",
			default: 0.8,
			describe: "Cosine similarity threshold (0..1)",
		})
		.option("group-cosine-max-minutes", {
			type: "number",
			default: 60 * 12,
			describe: "Max minutes apart for cosine similarity link",
		})
		// CLIP/classifier options
		.option("clip-embedder-model", {
			type: "string",
			default: "xenova/clip-vit-base-patch32",
			describe: "HF model id for image feature extraction",
		})
		.option("clip-classifier-model", {
			type: "string",
			default: "Xenova/siglip-large-patch16-384",
			describe: "HF model id for zero-shot image classification",
		})
		.option("clip-resize", {
			type: "number",
			default: 224,
			describe: "Resize square dimension for classifier input",
		})
		.option("clip-quality", {
			type: "number",
			default: 92,
			describe: "JPEG quality for classifier input",
		})
		.option("clip-hypothesis", {
			type: "string",
			default: "a photo of {}",
			describe: "Zero-shot hypothesis template",
		})
		.option("rename-model", {
			type: "string",
			default: "llava:7b",
			describe: "Vision model name for captioning (Ollama)",
		})
		.option("rename-delay", {
			type: "number",
			default: 100,
			describe: "Delay between captions in ms",
		})
		.option("rename-tags", {
			type: "number",
			default: 3,
			describe: "Max number of words to include in filename",
		})
		.option("rename-limit", {
			type: "number",
			describe: "Limit number of images to rename",
		})
		.option("rename-concurrency", {
			type: "number",
			default: 1,
			describe: "How many images to caption in parallel",
		})
		.option("rename-preview-quality", {
			type: "number",
			default: 70,
			describe: "JPEG quality for the preview sent to the model",
		})
		.option("rename-preview-size", {
			type: "number",
			default: 672,
			describe: "Square size for preview sent to the model",
		})
		// Compression options
		.option("compress-max-kb", {
			type: "number",
			default: 500,
			describe: "Only compress images larger than this size (KB)",
		})
		.option("compress-quality", {
			type: "number",
			default: 80,
			describe: "JPEG quality for compressed output",
		})
		.option("compress-max-dimension", {
			type: "number",
			default: 4000,
			describe: "Max width/height for resized images during compression",
		})
		// Scoring options
		.option("score-max-dim", {
			type: "number",
			default: 256,
			describe: "Max dimension for brightness/contrast/sharpness analysis",
		})
		.option("score-face-min-confidence", {
			type: "number",
			default: 0.3,
			describe: "Min confidence for face detection (0..1)",
		})
		.option("score-weight-brightness", { type: "number", default: 0.05 })
		.option("score-weight-contrast", { type: "number", default: 0.1 })
		.option("score-weight-sharpness", { type: "number", default: 0.1 })
		.option("score-weight-face", { type: "number", default: 0.15 })
		.option("score-weight-eyes", { type: "number", default: 0.15 })
		.option("score-weight-smile", { type: "number", default: 0.45 })
		.strict()
		.help()
		.parseAsync();

	const folder = path.resolve(String(argv.path));
	const out = path.resolve(String(argv.out));
	const keywords = String(argv.group).split(",");
	const exts = String(argv.ext)
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
	const skipSet = new Set(
		String(argv.skip)
			.split(",")
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean) as Step[],
	);

	const shouldRun = (s: Step) => !skipSet.has(s);
	// Glob once and pass files to steps
	const pattern = buildGlobPattern(exts);
	const filesRel = await fg([pattern], {
		cwd: folder,
		onlyFiles: true,
		unique: true,
		dot: false,
		caseSensitiveMatch: false,
	});
	const filesAbs = filesRel.map((f) => path.join(folder, f));

	// Configure CLIP/classifier and scoring based on CLI
	setClipConfig({
		embedderModel: String(argv["clip-embedder-model"]),
		classifierModel: String(argv["clip-classifier-model"]),
		resizeWidth: Number(argv["clip-resize"]) || 224,
		resizeHeight: Number(argv["clip-resize"]) || 224,
		jpegQuality: Number(argv["clip-quality"]) || 92,
		hypothesisTemplate: String(argv["clip-hypothesis"]) || "a photo of {}",
	});

	setScoreConfig({
		analysisMaxDim: Number(argv["score-max-dim"]) || 256,
		faceMinConfidence: Number(argv["score-face-min-confidence"]) || 0.3,
		weights: {
			brightness: Number(argv["score-weight-brightness"]) || 0.05,
			contrast: Number(argv["score-weight-contrast"]) || 0.1,
			sharpness: Number(argv["score-weight-sharpness"]) || 0.1,
			facePresence: Number(argv["score-weight-face"]) || 0.15,
			eyesOpen: Number(argv["score-weight-eyes"]) || 0.15,
			smiling: Number(argv["score-weight-smile"]) || 0.45,
		},
	});

	let groups: Awaited<ReturnType<typeof groupPhotos>> | undefined;
	let scored: Awaited<ReturnType<typeof scoreImages>> | undefined;
	const chosen: Awaited<ReturnType<typeof scoreImages>> = [];
	// 1) Group similar photos
	if (shouldRun("group")) {
		const clipped = await buildPhotosFromFiles(filesAbs);

		const pregroup = await preGroupPhotos(clipped, keywords, {
			threshold: Number(argv["pregroup-threshold"]) || 0.0001,
		});

		saveLog(pregroup, "pregroup.json");
		const matched = new Set(pregroup.flat().map((x) => x.path));
		//filter out pre-group matched from filesAbs to next group
		const clippedRemaining = clipped.filter((v) => !matched.has(v.path));

		groups = await groupPhotos(clippedRemaining, {
			secondsSeparated: Number(argv["group-seconds-separated"]) || 5,
			phash: Number(argv["group-phash"]) || 0.8,
			cosineSimilarityThreshold:
				Number(argv["group-cosine-threshold"]) || 0.8,
			cosineMaxMinutes: Number(argv["group-cosine-max-minutes"]) || 60 * 12,
		});
		// combine pregroup and groups
		pregroup.filter((x) => x.length > 0).flat().length > 0 &&
			groups.push(...pregroup.filter((x) => x.length > 0));

		saveLog(groups, "groups.json");
		scored = await scoreImages(groups, MODELS_DIR);

		if (scored.length > 0) {
			const allKeeps = await reviewAllGroupsBun(scored, {
				htmlPath: "./review/index.html",
				scriptPath: "./review/script.js",
			});

			allKeeps.forEach((indices, groupIndex) => {
				indices.forEach((i) => {
					if (scored?.[groupIndex] && scored[groupIndex][i]) {
						scored[groupIndex][i].keep = true;
					}
				});
			});
		}
		saveLog(chosen, "groups.scored.json");
	} else {
		console.log("⚠️ Skipping: group");
	}

	// 3) Move duplicates to a folder
	if (shouldRun("move")) {
		if (!scored) {
			throw new Error(
				"Cannot run 'move' without scores. Either run scoring or remove 'move' from --skip.",
			);
		}

		await moveDups(scored, out);
	} else {
		console.log("⚠️ Skipping: move");
	}

	// 4) Tag and rename images in place using provided file list
	if (shouldRun("rename")) {
		const keptFiles: string[] = chosen
			.flat()
			.filter((e) => e.keep)
			.map((e) => e.path);
		const listForRename = keptFiles.length > 0 ? keptFiles : filesAbs;

		await tagAndRenameFiles(listForRename, {
			delayMs: Number(argv["rename-delay"]) || 0,
			model: String(argv["rename-model"]) || "llava:7b",
			tagsInName: Number(argv["rename-tags"]) || 5,
			limit:
				typeof argv["rename-limit"] === "number"
					? Number(argv["rename-limit"])
					: undefined,
			concurrency: Number(argv["rename-concurrency"]) || 1,
			previewQuality: Number(argv["rename-preview-quality"]) || 70,
			previewSize: Number(argv["rename-preview-size"]) || 672,
		});
	} else {
		console.log("⚠️ Skipping: rename");
	}

	// 5) Compress images
	if (shouldRun("compress")) {
		await compressImagesInFolder(folder, Number(argv["compress-max-kb"]) || 500, {
			quality: Number(argv["compress-quality"]) || 80,
			resizeMaxDimension: Number(argv["compress-max-dimension"]) || 4000,
		});
	} else {
		console.log("⚠️ Skipping: compress");
	}
}

await main().catch((err) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exitCode = 1;
});
