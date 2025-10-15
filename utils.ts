import fg from "fast-glob";
import path from "node:path";

export function deArray<T>(value: T | T[]) {
	if (Array.isArray(value)) return value.at(0);
	return value;
}

function buildGlobPattern(exts: string[]): string {
	return `*.{${exts.join(",")}}`;
}

export async function getFilesInFolder(
	cwd: string,
	exts: string[],
): Promise<FileList> {
	const pattern = buildGlobPattern(exts);
	const filesRel = await fg([pattern], {
		cwd: cwd,
		onlyFiles: true,
		unique: true,
		dot: false,
		caseSensitiveMatch: false,
	});
	return filesRel.map((f) => path.join(cwd, f));
}
