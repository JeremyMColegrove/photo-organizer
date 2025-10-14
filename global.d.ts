// Global type declarations for the PhotoOrganizer project

// Common file/path types
type ImagePath = string;
type FileList = ReadonlyArray<ImagePath>;

// Pipeline step identifiers
type Step = "group" | "move" | "rename" | "compress";

// Narrow union of common image extensions (lowercase)
type ImageExtension =
	| "jpg"
	| "jpeg"
	| "png"
	| "webp"
	| "heic"
	| "heif"
	| "tiff"
	| "bmp"
	| "gif";

// Grouping types
type ImageEntry = { path: string };
type ImageGroup = ImageEntry[];

// Scoring types
type ScoreBreakdown = {
	brightness: number; // 0..1
	contrast: number; // 0..1
	sharpness: number; // 0..1
	facePresence: number; // 0..1
	eyesOpen: number; // 0..1
	smiling: number; // 0..1
};

type ImageScore = {
	path: string;
	score: number; // 0..1
	breakdown: ScoreBreakdown;
};

type ScoreEntry = { path: string; score: ImageScore; keep: boolean };
type ScoreGroup = ScoreEntry[];

// Optional: cascade model paths (declared but currently unused)
type CascadePaths = {
	face: string;
	eyes: string;
	smile: string;
};

// Progress bar options
type BarOptions = {
	task?: string;
	detail?: string;
	color?: (text: string) => string;
};

// Options for grouping (public API of groupPhotos)
interface GroupOptions {
	/** pHash similarity threshold (0–1), default 0.85 */
	phash?: number;
	/** minutes apart to group together, default 1 */
	secondsSeparated?: number;
	/** threshold for photo to be considered similar, default 0.8 */
	cosineSimilarityThreshold?: number;
	cosineMaxMinutes?: number;
}

// Options for rename/tagging pipeline
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
	/** How many images to caption in parallel */
	concurrency?: number; // default: 3
};
