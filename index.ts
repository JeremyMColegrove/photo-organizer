import fg from "fast-glob";
import fs from "node:fs";
import path from "node:path";
import { hideBin } from "yargs/helpers";
import yargs from "yargs/yargs";
import { compressImagesInFolder } from "./compress/compress";
import { groupPhotos } from "./group";
import { buildPhotosFromFiles } from "./group/clip";
import { moveDups } from "./moves/move";
import preGroupPhotos from "./pregroup/pregroup";
import { tagAndRenameFiles } from "./rename/rename";
import { reviewAllGroupsBun } from "./review/review";
import { scoreImages } from "./score/score";

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

	let groups: Awaited<ReturnType<typeof groupPhotos>> | undefined;
	let scored: Awaited<ReturnType<typeof scoreImages>> | undefined;
	const chosen: Awaited<ReturnType<typeof scoreImages>> = [];
	// 1) Group similar photos
	if (shouldRun("group")) {
		const clipped = await buildPhotosFromFiles(filesAbs);

		const pregroup = await preGroupPhotos(clipped, keywords, {
			threshold: 0.001,
		});

		saveLog(pregroup, "pregroup.json");
		const matched = new Set(pregroup.flat().map((x) => x.path));
		//filter out pre-group matched from filesAbs to next group
		const clippedRemaining = clipped.filter((v) => !matched.has(v.path));

		groups = await groupPhotos(clippedRemaining, {
			secondsSeparated: 5,
			phash: 0.8,
			cosineSimilarityThreshold: 0.8,
			cosineMaxMinutes: 60 * 12,
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
			concurrency: 1,
		});
	} else {
		console.log("⚠️ Skipping: rename");
	}

	// 5) Compress images
	if (shouldRun("compress")) {
		await compressImagesInFolder(folder, 500);
	} else {
		console.log("⚠️ Skipping: compress");
	}
}

await main().catch((err) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exitCode = 1;
});
