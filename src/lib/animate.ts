/**
 * turn.js's own tweener (`$.fn.animatef`), ported as-is.
 *
 * It steps a fixed `fps` milliseconds per tick rather than following the wall clock, and eases
 * with a circular ease-out. Both matter to how a turn feels, so both are kept.
 */

export type Easing = (x: number, time: number, from: number, diff: number, duration: number) => number;

/** turn.js's default: `c * sqrt(1 - (t/d - 1)^2) + b`, a circular ease-out. */
export const circularEaseOut: Easing = (_x, time, from, diff, duration) => {
	const t = time / duration - 1;

	return diff * Math.sqrt(1 - t * t) + from;
};

export interface AnimationRequest {
	from: number | number[];
	to: number | number[];
	duration: number;
	frame: (value: number & number[]) => void;
	complete?: () => void;
	easing?: Easing;
	/** Interval between frames in milliseconds; turn.js names this `fps` and defaults it to 30. */
	fps?: number;
	/** Set while a page is turning all the way over, as opposed to peeling or springing back. */
	turning?: boolean;
	/** Set while a fold is being put back down. */
	hiding?: boolean;
}

export interface Animation {
	readonly turning: boolean;
	readonly hiding: boolean;
	/** turn.js deletes its effect when it settles; callers treat a done animation as absent. */
	done: boolean;
	stop: () => void;
}

/**
 * Runs `request` and returns a handle, or stops the running animation when passed `false`.
 * Mirrors `animatef`, including the first frame being emitted synchronously.
 */
export function animatef(current: Animation | undefined, request: AnimationRequest | false): Animation | undefined {
	current?.stop();

	if (!request) return undefined;

	const to = Array.isArray(request.to) ? request.to : [request.to];
	const from = Array.isArray(request.from) ? request.from : [request.from];
	const easing = request.easing ?? circularEaseOut;
	const fps = request.fps ?? 30;
	const diff = to.map((value, index) => value - from[index]);

	let time = -fps;
	let handle: ReturnType<typeof setInterval> | undefined;
	let done = false;

	const animation: Animation = {
		turning: Boolean(request.turning),
		hiding: Boolean(request.hiding),
		done: false,
		stop() {
			if (handle !== undefined) clearInterval(handle);
			handle = undefined;
			done = true;
			animation.done = true;
		}
	};

	const step = () => {
		if (done) return;
		time = Math.min(request.duration, time + fps);

		const values = to.map((_value, index) =>
			easing(1, time, from[index], diff[index], request.duration)
		);

		request.frame((values.length === 1 ? values[0] : values) as number & number[]);

		if (time === request.duration) {
			animation.stop();
			request.complete?.();
		}
	};

	handle = setInterval(step, fps);
	step();

	return animation;
}
