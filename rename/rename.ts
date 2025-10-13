import fg from "fast-glob";
import fs from "node:fs/promises";
import path from "node:path";
import ollama from "ollama";
import bar from "../bar";

type TaggerOptions = {
	/** Vision model name (must support images) */
	model?: string; // default: llava:13b
	/** Max files to process; omit for all */
	limit?: number;
	/** Delay between files (ms) */
	delayMs?: number; // default: 800
	/** number of tags to include in filename (1-8 is good) */
	tagsInName?: number; // default: 5

	prefix?: string;
	suffix?: string;
	separator?: string;
};

const DEFAULTS: Required<Omit<TaggerOptions, "limit">> = {
	model: "llava:7b",
	delayMs: 800,
	tagsInName: 5,
	prefix: "",
	suffix: "",
	separator: "-",
};

/**
 * Main entry: walks the folder, tags each image with a local vision model, and renames it.
 */
export async function tagAndRenameImages(
	folder: string,
	opts: TaggerOptions = {},
): Promise<void> {
	const o = { ...DEFAULTS, ...opts };

    const files = await fg(["*.{jpg,jpeg,png,webp,bmp,gif,tiff,heic,heif}"], {
        cwd: folder,
        onlyFiles: true,
        dot: false,
        unique: true,
        // Ensure uppercase extensions are matched too across platforms
        caseSensitiveMatch: false,
    });
	const selected = files.slice(0, opts.limit);

	if (selected.length === 0) {
		console.log("No images found.");
		return;
	}

	const b = bar.start(0, selected.length, { task: "Captioning photos" });
	for (let i = 0; i < selected.length; i++) {
		const rel = selected[i];
		const abs = path.resolve(folder, rel as string);
		try {
			const tags = await generateTags(abs, o);

			if (!tags.length) {
				console.log(`(${i + 1}/${selected.length}) Skipped (no tags): ${rel}`);
			} else {
				await proposeRename(abs, tags, o.tagsInName, opts);
			}
		} catch (err) {
			console.warn(
				`\n(${i + 1}/${selected.length}):`,
				err instanceof Error ? err.message : String(err),
			);
		} finally {
			b.increment();
		}

		// slow it down between files
		if (o.delayMs > 0 && i < selected.length - 1) {
			await sleep(o.delayMs);
		}
	}
	b.complete();
}

/* ---------------- helpers ---------------- */

async function generateTags(
	imagePath: string,
	o: Required<Omit<TaggerOptions, "limit">>,
): Promise<string[]> {
	// read and encode the image (Ollama expects base64 for image parts)
	const base64 = await fs.readFile(imagePath); //.then((b) => b.toString("base64"));

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
		images: [base64],
	});

	const raw = res.response?.trim() ?? "[]";

	const tags: string[] = raw.replaceAll(/[^a-zA-Z ]/g, "").split(" ");

	return dedupePreservingOrder(tags);
}

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

function dedupePreservingOrder<T>(arr: T[]): T[] {
	const seen = new Set<string>();
	const out: T[] = [];
	for (const v of arr) {
		const key = typeof v === "string" ? v : JSON.stringify(v);
		if (!seen.has(key)) {
			seen.add(key);
			out.push(v);
		}
	}
	return out;
}

function sleep(ms: number): Promise<void> {
	return new Promise((res) => setTimeout(res, ms));
}
