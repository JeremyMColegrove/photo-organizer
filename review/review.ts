// review-bun.ts — Bun 1.1+
// Usage: const keep = await reviewGroupBun(group, { htmlPath: 'path/to/review.html' });

// ScoreEntry and ImageScore are provided globally via global.d.ts

type Options = {
	port?: number; // default 8787
	htmlPath: string; // absolute/relative path to review.html
	scriptPath: string;
	root?: string; // if some paths are relative, resolve against this root
	getScoreNumber?: (s: ImageScore) => number; // defaults to Number(score)
	recommendedIndex?: number; // optional override
};

export async function reviewGroupBun(
	group: ScoreEntry[],
	opts: Options,
): Promise<number[]> {
	const port = opts.port ?? 8757;
	const htmlFile = Bun.file(opts.htmlPath);
	const jsFile = Bun.file(opts.scriptPath);
	// Resolve to absolute file paths (no sanitization; local only)
	const files = group.map((g) =>
		isAbs(g.path) || !opts.root ? g.path : join(opts.root!, g.path),
	);

	// Build payload for the page
	const scores = group.map((g) => g.score);
	let recommendedIndex = 0;
	let best = 0;
	for (const [index, value] of scores.entries()) {
		if (value.score > best) {
			best = value.score;
			recommendedIndex = index;
		}
	}

	// Promise that resolves when user saves
	let resolveKeep!: (v: number[]) => void;
	const decided = new Promise<number[]>((r) => {
		resolveKeep = r;
	});

	const server = Bun.serve({
		port,
		reusePort: false,
		async fetch(req) {
			const url = new URL(req.url);
			const { pathname } = url;

			// HTML
			if (pathname === "/" || pathname === "/review") {
				return new Response(htmlFile, {
					headers: { "Content-Type": "text/html; charset=utf-8" },
				});
			}

			// Serve JS
			if (pathname === "/script.js") {
				return new Response(jsFile, {
					headers: { "Content-Type": "application/javascript; charset=utf-8" },
				});
			}

			// Data for the page
			if (pathname === "/api/data") {
				const items = files.map((_, i) => ({
					i,
					score: scores[i],
					recommended: i === recommendedIndex,
				}));
				return Response.json({ items });
			}

			// Serve original image bytes by index
			if (pathname.startsWith("/img/")) {
				const idx = Number(pathname.slice("/img/".length));
				if (!Number.isInteger(idx) || idx < 0 || idx >= files.length) {
					return new Response("Not found", { status: 404 });
				}
				try {
					const f = Bun.file(files[idx]!);
					return new Response(f, {
						headers: { "Content-Type": mime(files[idx]!) },
					});
				} catch {
					return new Response("Not found", { status: 404 });
				}
			}

			// Accept selection
			if (pathname === "/api/decide" && req.method === "POST") {
				try {
					const body = (await req.json()) as { keep: number[] };
					if (!body || !Array.isArray(body.keep)) throw new Error("invalid");
					queueMicrotask(async () => {
						try {
							server.stop(true);
						} catch {}
						await new Promise((r) => setTimeout(r, 200));
						setTimeout(() => server.stop(true), 10);
						resolveKeep((body.keep as number[]).sort((a, b) => a - b));
					});
					return Response.json({ ok: true });
				} catch (e) {
					return Response.json(
						{ ok: false, error: String(e) },
						{ status: 400 },
					);
				}
			}

			return new Response("Not found", { status: 404 });
		},
	});

	openInBrowser(`http://127.0.0.1:${port}/review`);
	return await decided;
}

/* -------------- helpers -------------- */

function isAbs(p: string) {
	return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}
function join(a: string, b: string) {
	if (a.endsWith("/") || a.endsWith("\\")) return a + b.replace(/^[/\\]/, "");
	const sep = a.includes("\\") ? "\\" : "/";
	return a + sep + b.replace(/^[/\\]/, "");
}
function mime(name: string) {
	const ext = name.toLowerCase().split(".").pop() || "";
	if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
	if (ext === "png") return "image/png";
	if (ext === "webp") return "image/webp";
	if (ext === "gif") return "image/gif";
	if (ext === "heic" || ext === "heif") return "image/heic";
	return "application/octet-stream";
}
function openInBrowser(url: string) {
	if (process.platform === "darwin")
		Bun.spawn(["open", url], {
			stdout: "ignore",
			stderr: "ignore",
			// detached: true,
		});
	else if (process.platform === "win32")
		Bun.spawn(["cmd", "/c", "start", "", url], {
			// shell: true,
			stdout: "ignore",
			stderr: "ignore",
			// detached: true,
		});
	else
		Bun.spawn(["xdg-open", url], {
			stdout: "ignore",
			stderr: "ignore",
			// detached: true,
		});
}
