import fs from "node:fs";
import path from "node:path";
import { hideBin } from "yargs/helpers";
import yargs from "yargs/yargs";
import { compressImagesInFolder } from "./compress/compress";
import { groupPhotos } from "./group";
import { moveDups } from "./moves/move";
import { tagAndRenameImages } from "./rename/rename";
import { reviewGroupBun } from "./review/review";
import { scoreImages } from "./score/score";

const MODELS_DIR = path.resolve("models");

type Step = "group" | "move" | "rename" | "compress";

function saveLog(json: unknown, name: string) {
	fs.writeFileSync(name, JSON.stringify(json));
}

async function main() {
	const argv = await yargs(hideBin(process.argv))
		.option("folder", {
			type: "string",
			demandOption: true,
			describe: "Folder containing photos to organize",
		})
		.option("skip", {
			type: "string",
			default: "",
			describe: "Comma-separated steps to skip: group,move,rename,compress",
		})
		.strict()
		.help()
		.parseAsync();

	const folder = path.resolve(String(argv.folder));
	const skipSet = new Set(
		String(argv.skip)
			.split(",")
			.map((s) => s.trim().toLowerCase())
			.filter(Boolean) as Step[],
	);

	const shouldRun = (s: Step) => !skipSet.has(s);

	let groups: Awaited<ReturnType<typeof groupPhotos>> | undefined;
	let scored: Awaited<ReturnType<typeof scoreImages>> | undefined;
	const chosen: Awaited<ReturnType<typeof scoreImages>> = [];
	// 1) Group similar photos
	if (shouldRun("group")) {
		groups = await groupPhotos(folder, {
			secondsSeparated: 3,
			phash: 0.8,
			cosineSimilarityThreshold: 0.9,
			cosineMaxMinutes: 60 * 24,
		});
		saveLog(groups, "groups.json");
		scored = await scoreImages(groups, MODELS_DIR);
		for (var group of scored) {
			const res = await reviewGroupBun(group, {
				htmlPath: "./review/index.html",
				scriptPath: "./review/script.js",
			});

			chosen.push(
				group.map((ele, i) => ({
					...ele,
					keep: res.includes(i),
				})),
			);
		}
		saveLog(scored, "groups.scored.json");
	} else {
		console.log("Skipping: group");
	}

	// 3) Move duplicates to a folder
	if (shouldRun("move")) {
		if (!chosen) {
			throw new Error(
				"Cannot run 'move' without scores. Either run scoring or remove 'move' from --skip.",
			);
		}
		const dest = path.resolve("./duplicates");
		await moveDups(chosen, dest);
	} else {
		console.log("Skipping: move");
	}

	// 4) Tag and rename images in place
	if (shouldRun("rename")) {
		await tagAndRenameImages(folder, {
			delayMs: 100,
			model: "llava:7b",
			tagsInName: 5,
		});
	} else {
		console.log("Skipping: rename");
	}

	// 5) Compress images
	if (shouldRun("compress")) {
		await compressImagesInFolder(folder, 500);
	} else {
		console.log("Skipping: compress");
	}
}

await main().catch((err) => {
	console.error(err instanceof Error ? err.message : String(err));
	process.exitCode = 1;
});
