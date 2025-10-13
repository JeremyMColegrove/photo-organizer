// bar.ts

import chalk from "chalk";
import cliProgress from "cli-progress";

type BarOptions = {
	task?: string;
	color?: (text: string) => string;
};

class ProgressBar {
	private bar: cliProgress.SingleBar;
	private total: number;

	constructor(start: number, total: number, options?: BarOptions) {
		const color = options?.color ?? chalk.green;
		this.total = total;

		this.bar = new cliProgress.SingleBar(
			{
				format:
					`${chalk.cyan.bold("📸 {task}")}` +
					`|${color("{bar}")}| {percentage}% ` +
					`${chalk.dim("({value}/{total})")} | ${chalk.gray("ETA: {eta_formatted}")}`,
				barCompleteChar: "█",
				barIncompleteChar: "░",
				hideCursor: true,
			},
			cliProgress.Presets.shades_classic,
		);

		this.bar.start(total, start, { task: options?.task ?? "Starting..." });
	}

	/** Update progress to a specific value */
	update(value: number, payload?: BarOptions) {
		this.bar.update(value, payload);
	}

	/** Increment by n (default 1) */
	increment(n = 1, payload?: BarOptions) {
		this.bar.increment(n, payload);
	}

	/** Complete and stop the bar */
	complete(options?: BarOptions) {
		if (options?.task) this.bar.update(this.total, { task: options.task });
		this.bar.stop();
		console.log(chalk.green.bold("✅ Done!"));
	}
}

export default {
	/** Start a new progress bar */
	start(start: number, total: number, options?: BarOptions) {
		return new ProgressBar(start, total, options);
	},
};
