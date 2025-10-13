export type ScoreBreakdown = {
	brightness: number; // 0..1
	contrast: number; // 0..1
	sharpness: number; // 0..1
	facePresence: number; // 0..1
	eyesOpen: number; // 0..1
	smiling: number; // 0..1
};

export type ImageScore = {
	path: string;
	score: number; // 0..1
	breakdown: ScoreBreakdown;
};

export type CascadePaths = {
	face: string;
	eyes: string;
	smile: string;
};
