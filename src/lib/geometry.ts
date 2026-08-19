/**
 * Geometry helpers, ported from turn.js (Emmanuel Garcia, 3rd release).
 *
 * These are the primitives the fold is built from: turn.js works in page-local pixel space,
 * measures the fold from a dragged corner, and paints its shading with linear gradients whose
 * angle and colour stops it computes per frame.
 */

export interface Point2D {
	x: number;
	y: number;
}

export type CornerName = 'tl' | 'tr' | 'bl' | 'br';

export const PI = Math.PI;

/** A right angle in radians; turn.js calls this A90 and compares fold angles against it. */
export const A90 = PI / 2;

export const point2D = (x: number, y: number): Point2D => ({ x, y });

/** A 2D point on a cubic bezier of four control points. */
export function bezier(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D, t: number): Point2D {
	const mum1 = 1 - t;
	const mum13 = mum1 * mum1 * mum1;
	const mu3 = t * t * t;

	return point2D(
		Math.round(mum13 * p1.x + 3 * t * mum1 * mum1 * p2.x + 3 * t * t * mum1 * p3.x + mu3 * p4.x),
		Math.round(mum13 * p1.y + 3 * t * mum1 * mum1 * p2.y + 3 * t * t * mum1 * p3.y + mu3 * p4.y)
	);
}

export const rad = (degrees: number): number => (degrees / 180) * PI;

export const deg = (radians: number): number => (radians / PI) * 180;

/**
 * turn.js switches between `translate3d` and `translate` so that a page can opt out of hardware
 * acceleration; the 3d form promotes the layer, which is what keeps a drag smooth.
 */
export function translate(x: number, y: number, use3d: boolean): string {
	return use3d ? ` translate3d(${x}px,${y}px, 0px) ` : ` translate(${x}px, ${y}px) `;
}

export function rotate(degrees: number): string {
	return ` rotate(${degrees}deg) `;
}

export function setTransform(element: HTMLElement, transform: string, origin?: string) {
	if (origin) element.style.transformOrigin = origin;
	element.style.transform = transform;
}

/** The document-space offset of an element, matching what jQuery's `.offset()` returned. */
export function offset(element: HTMLElement): Point2D {
	const rect = element.getBoundingClientRect();
	const docElement = document.documentElement;

	return point2D(
		rect.left + window.pageXOffset - docElement.clientLeft,
		rect.top + window.pageYOffset - docElement.clientTop
	);
}

export type GradientStop = [position: number, color: string];

/**
 * Paints one of the fold's shadows.
 *
 * turn.js describes its shading the way the old `-webkit-gradient(linear, p0, p1, ...)` did: a
 * line from `from` to `to` in the element's own percentage space, with stops running 0..1 along
 * it. Chrome is what turn.js picks that branch for, and it is what these shadows were tuned
 * against — its other branch is a non-webkit workaround whose angle is a quarter turn out.
 *
 * `linear-gradient` instead measures its angle from "to top" clockwise and runs its line through
 * the centre of the box, so both the angle and every stop are re-projected onto that line here.
 */
export function gradient(
	element: HTMLElement,
	width: number,
	height: number,
	from: Point2D,
	to: Point2D,
	colors: GradientStop[]
) {
	const p0 = point2D((from.x / 100) * width, (from.y / 100) * height);
	const p1 = point2D((to.x / 100) * width, (to.y / 100) * height);
	const dx = p1.x - p0.x;
	const dy = p1.y - p0.y;
	const span = Math.sqrt(dx * dx + dy * dy);

	if (!span) {
		element.style.backgroundImage = '';

		return;
	}

	const angle = Math.atan2(dx, -dy);
	const line = Math.abs(width * Math.sin(angle)) + Math.abs(height * Math.cos(angle));
	const unit = point2D(dx / span, dy / span);
	// Where `from` sits along that centred line, as a fraction of it.
	const start =
		((p0.x - width / 2) * unit.x + (p0.y - height / 2) * unit.y) / line + 0.5;
	const step = span / line;

	const stops = colors.map(
		([position, color]) => ` ${color} ${(start + step * position) * 100}%`
	);

	element.style.backgroundImage = `linear-gradient(${angle}rad,${stops.join(',')})`;
}
