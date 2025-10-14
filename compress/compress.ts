import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import bar from "../bar";

/**
 * Compresses all image files in the given folder (non-recursive) to under 500 KB.
 * Supported formats: jpg, jpeg, png, webp, heic, tiff
 */
export async function compressImagesInFolder(
	folderPath: string,
	maxSizeKB = 500,
): Promise<void> {
	const files = await fs.readdir(folderPath, { withFileTypes: true });
	const images = files.filter(
		(f) => f.isFile() && /\.(jpe?g|png|webp|heic|tiff)$/i.test(f.name),
	);

	const b = bar.start(0, images.length, { task: "Compressing" });
	let totalOriginalBytes = 0;
	let totalCompressedBytes = 0;
	let processedCount = 0;
	for (const img of images) {
		b.increment();
		const inputPath = path.join(folderPath, img.name);
		const outputPath = path.join(folderPath, img.name); // overwrite same file
		const buffer = await fs.readFile(inputPath);

		// Skip small images
		if (buffer.byteLength / 1024 < maxSizeKB) continue;

		const image = sharp(buffer, { failOn: "none" });
		const metadata = await image.metadata();
		const quality = 80; // start quality
		const compressed = await sharp(buffer)
			.rotate() // auto-orient
			.resize({
				// limit max dimension for huge photos
				width: metadata.width && metadata.width > 4000 ? 4000 : undefined,
				height: metadata.height && metadata.height > 4000 ? 4000 : undefined,
				fit: "inside",
				withoutEnlargement: true,
			})
			.jpeg({
				quality,
				mozjpeg: true, // more efficient entropy coding
				chromaSubsampling: "4:2:0",
				progressive: true, // smaller + faster progressive loads
			})
			.withMetadata({
				orientation: 1, // normalize orientation
			})
			.toBuffer();

		totalOriginalBytes += buffer.byteLength;
		totalCompressedBytes += compressed.byteLength;
		processedCount++;

		// Iteratively reduce until under maxSizeKB
		// compressed = await sharp(buffer).rotate().jpeg({ quality }).toBuffer();

		// Save compressed file
		await fs.writeFile(outputPath, compressed);
	}
	b.complete();

	// Print overall % improvement
	if (processedCount > 0 && totalOriginalBytes > 0) {
		const improvement =
			((totalOriginalBytes - totalCompressedBytes) / totalOriginalBytes) * 100;
		console.log(
			`Compression improvement: ${improvement.toFixed(2)}% over ${processedCount} image(s).`,
		);
	}
}

/**
 * New: compress only the provided files.
 */
export async function compressImages(
	files: FileList,
	maxSizeKB = 500,
): Promise<void> {
	const b = bar.start(0, files.length, { task: "Compressing" });
	let totalOriginalBytes = 0;
	let totalCompressedBytes = 0;
	let processedCount = 0;
	for (const inputPath of files) {
		b.increment();
		try {
			const buffer = await fs.readFile(inputPath);
			if (buffer.byteLength / 1024 < maxSizeKB) continue;

			const image = sharp(buffer, { failOn: "none" });
			const metadata = await image.metadata();
			const quality = 80;
			const compressed = await sharp(buffer)
				.rotate()
				.resize({
					width: metadata.width && metadata.width > 4000 ? 4000 : undefined,
					height: metadata.height && metadata.height > 4000 ? 4000 : undefined,
					fit: "inside",
					withoutEnlargement: true,
				})
				.jpeg({
					quality,
					mozjpeg: true,
					chromaSubsampling: "4:2:0",
					progressive: true,
				})
				.withMetadata({ orientation: 1 })
				.toBuffer();

			totalOriginalBytes += buffer.byteLength;
			totalCompressedBytes += compressed.byteLength;
			processedCount++;

			await fs.writeFile(inputPath, compressed);
		} catch {
			// ignore individual file failures
		}
	}
	b.complete();

	if (processedCount > 0 && totalOriginalBytes > 0) {
		const improvement =
			((totalOriginalBytes - totalCompressedBytes) / totalOriginalBytes) * 100;
		console.log(
			`Compression improvement: ${improvement.toFixed(2)}% over ${processedCount} image(s).`,
		);
	}
}
