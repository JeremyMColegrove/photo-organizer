import nlp from "compromise";
import fs from "node:fs/promises";
import path from "node:path";
import ollama from "ollama";
import sharp from "sharp";
import bar from "../bar";

// TaggerOptions is now globally defined in global.d.ts

const DEFAULTS: Required<Omit<TaggerOptions, "limit">> = {
	model: "llava:7b",
	delayMs: 0,
	tagsInName: 5,
	prefix: "",
	suffix: "",
	separator: "-",
	concurrency: 3,
};

/**
 * New: tag and rename a provided file list (absolute paths recommended).
 */
export async function tagAndRenameFiles(
	files: FileList,
	opts: TaggerOptions = {},
): Promise<void> {
	const o = { ...DEFAULTS, ...opts };
	const selected = opts.limit ? files.slice(0, opts.limit) : [...files];

	if (selected.length === 0) {
		console.log("No images provided.");
		return;
	}

	const b = bar.start(0, selected.length, { task: "Captioning photos" });

	// Simple single-threaded processing for clarity
	for (const [i, f] of selected.entries()) {
		const abs = path.resolve(String(f));
		const rel = path.basename(abs);
		try {
			const buffer = await sharp(abs)
				.jpeg({
					quality: 70,
				})
				.resize({
					width: 672,
					height: 672,
					fit: "cover",
					withoutEnlargement: true,
				})
				.toBuffer();

			const tags = await generateTagsFromBuffer(buffer, o);

			if (!tags || !tags.length) {
				console.log(`(${i + 1}/${selected.length}) Skipped (no tags): ${rel}`);
			} else {
				await proposeRename(abs, tags, o.tagsInName, opts);
			}
		} catch (e) {
			console.error(e);
			// skip
		} finally {
			b.increment();
		}
	}

	b.complete();
}

/* ---------------- helpers ---------------- */
// const pline = await pipeline(
// 	"image-to-text",
// 	"Xenova/vit-gpt2-image-captioning",
// 	{ dtype: "fp32", device: "gpu" },
// );
async function generateTagsFromBuffer(
	buffer: Buffer,
	o: Required<Omit<TaggerOptions, "limit">>,
): Promise<string[]> {
	// ask the model for compact, lowercase keywords as a JSON array
	const userPrompt =
		"You are naming a photograph for file organization. \
			Look at the image and describe what it mainly shows in 1–3 simple words — no punctuation, no numbers, no special characters. \
			Avoid personal names, or camera details. \
			Output only the name in lowercase words separated by spaces. \
			Example outputs: \
			sunset over lake \n\
			family hiking trail \n\
			cat sleeping on couch";

	const res = await ollama.generate({
		model: o.model,
		stream: false,
		prompt: userPrompt,
		images: [buffer],
		keep_alive: "5m",
	});

	const raw = res.response?.trim() ?? "";

	const tags: string = raw.replaceAll(/[^a-zA-Z ]/g, "");
	const doc = nlp(tags);
	const nouns = doc
		.match("#Noun")
		.text()
		.split(" ")
		.filter((x) => !forbidden.includes(x));
	return nouns;
	// const out = await pline(new Blob([buffer]));
	// console.log(out);
	// const res = out[0];

	// const word =
	// 	(Array.isArray(res) ? res.at(0)?.generated_text : res?.generated_text) ??
	// 	"";

	// const doc = nlp(word);
	// const nouns = doc
	// 	.match("#Noun")
	// 	.text()
	// 	.split(" ")
	// 	.filter((x) => !forbidden.includes(x));
	// console.log(nouns);
	// return nouns;
}

const forbidden = ["man", "woman", "person", "group", "people", "picture"];

async function proposeRename(
	absPath: string,
	tags: string[],
	tagsInName: number,
	opts: TaggerOptions,
): Promise<string> {
	const dir = path.dirname(absPath);
	const ext = path.extname(absPath).toLowerCase();

	// current base name without extension
	const base = path.basename(absPath, ext);

	// build a slug from top N tags; keep short and readable
	const candidate = slugify(
		tags.slice(0, Math.max(1, tagsInName)).join(" "),
		opts,
	);

	// avoid ridiculous length
	const safe = candidate.slice(0, 120);

	// if the current name already starts with the slug, skip rename
	if (base.startsWith(safe)) {
		return absPath;
	}

	const target = await ensureUniquePath(path.join(dir, `${safe}${ext}`));

	if (target !== absPath) {
		await fs.rename(absPath, target);
	}

	return target;
}

function slugify(input: string, opts: TaggerOptions): string {
	return (
		(opts.prefix ?? "") +
		input
			.toLowerCase()
			.normalize("NFKD")
			.replace(/[\u0300-\u036f]/g, "") // strip diacritics
			.replace(/[^a-z0-9]+/g, opts.separator ?? "-")
			.replace(/^-+|-+$/g, "")
			.replace(/-{2,}/g, "-") +
		(opts.suffix ?? "")
	);
}

async function ensureUniquePath(p: string): Promise<string> {
	const dir = path.dirname(p);
	const ext = path.extname(p);
	const base = path.basename(p, ext);

	let i = 0;
	let candidate = p;
	while (true) {
		try {
			await fs.access(candidate);
			i += 1;
			candidate = path.join(dir, `${base}-${i}${ext}`);
		} catch {
			// doesn't exist → safe to use
			return candidate;
		}
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((res) => setTimeout(res, ms));
}
