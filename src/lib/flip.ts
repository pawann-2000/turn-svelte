/**
 * The page-fold effect, ported from turn.js's `flipMethods` (Emmanuel Garcia, 3rd release).
 *
 * The fold is not drawn: it is built out of three nested boxes that clip each other.
 *
 * - The page itself is rotated by the fold angle inside `wrapper`, a square box big enough to
 *   hold the page at any rotation. `wrapper` is counter-rotated by the same angle, so what shows
 *   through its `overflow: hidden` edge is the triangle of paper still lying flat.
 * - `fwrapper` repeats the trick one layer up, in the book's own coordinate space, and carries
 *   `fpage` — the *next* page element, moved into place and rotated to sit face down. That is
 *   the underside of the leaf being lifted.
 * - Two gradients follow the crease: `ashadow` over the underside, `bshadow` over the page the
 *   fold is falling across.
 *
 * All of the geometry below is turn.js's, variable for variable.
 */

import { animatef, type Animation } from './animate.js';
import {
	A90,
	PI,
	bezier,
	deg,
	gradient,
	offset,
	point2D,
	rotate,
	setTransform,
	translate,
	type CornerName,
	type Point2D
} from './geometry.js';
import type { TurnCorners, TurnDisplay } from './types.js';

const corners: Record<string, CornerName[]> = {
	backward: ['bl', 'tl'],
	forward: ['br', 'tr'],
	all: ['tl', 'bl', 'tr', 'br']
};

export interface FoldPoint extends Point2D {
	corner: CornerName;
}

export interface FlipOptions {
	page: number;
	next: number;
	folding?: HTMLElement | null;
	corners: TurnCorners;
	cornerSize: number;
	gradients?: boolean;
	frontGradient: boolean;
	backGradient: boolean;
	duration: number;
	acceleration: boolean;
	zIndex?: number | null;
	/** Set when the book redirects a turn to a page that is not the page's natural neighbour. */
	force?: boolean;
	/** The page number the book registered as moving, so it can be cleared again. */
	pageMv?: number;
}

/** What the fold needs to know about the book it belongs to. */
export interface FlipHost {
	element: HTMLElement;
	display: () => TurnDisplay;
	totalPages: () => number;
	pageObj: (page: number) => HTMLElement | undefined;
	foldParent: () => HTMLElement;
	elevation: () => number;
}

export interface FlipCallbacks {
	/** Return false to prevent the fold, as `event.preventDefault()` did on turn.js's `start`. */
	start?: (options: FlipOptions, corner: CornerName, originalEvent?: Event) => boolean | void;
	pressed?: () => void;
	/** Return false to keep the fold up, which is how a short press becomes a full turn. */
	released?: (point: FoldPoint) => boolean | void;
	end?: (turned: boolean) => void;
	flip?: () => void;
}

export class Flip {
	readonly element: HTMLElement;
	options: FlipOptions;

	private readonly host: FlipHost;
	private readonly callbacks: FlipCallbacks;

	private width = 0;
	private height = 0;

	private parent!: HTMLElement;
	private wrapper!: HTMLElement;
	private fwrapper!: HTMLElement;
	private fpageParent!: HTMLElement;
	private fpage!: HTMLElement;
	private ashadow?: HTMLElement;
	private bshadow?: HTMLElement;

	private backParent?: HTMLElement | null;
	private effect?: Animation;

	point: FoldPoint | null = null;
	corner: FoldPoint | null = null;
	disabled: boolean | number = false;
	/** Timestamp of the press, so the book can tell a click from a drag. */
	pressedAt = 0;

	constructor(element: HTMLElement, options: FlipOptions, host: FlipHost, callbacks: FlipCallbacks) {
		this.element = element;
		this.options = options;
		this.host = host;
		this.callbacks = callbacks;

		if (options.gradients) {
			this.options.frontGradient = true;
			this.options.backGradient = true;
		}

		this.addPageWrapper();
	}

	/** The running animation, if any. A settled one counts as none, as it did in turn.js. */
	private activeEffect(): Animation | undefined {
		return this.effect && !this.effect.done ? this.effect : undefined;
	}

	setOptions(options: Partial<FlipOptions>) {
		this.options = { ...this.options, ...options };
	}

	/** `flip('z')`: lifts the folded layer to the z-index the book hands down. */
	z(z: number | null) {
		this.options.zIndex = z;
		this.fwrapper.style.zIndex = String(z || Number.parseInt(this.parent.style.zIndex, 10) || 0);
	}

	private allowedCorners(): CornerName[] {
		const wanted = this.options.corners;

		return Array.isArray(wanted) ? wanted : corners[wanted] ?? corners.forward;
	}

	/** The page-local corner point, optionally inset by `inset`. */
	private c(corner: CornerName, inset = 0): Point2D {
		return {
			tl: point2D(inset, inset),
			tr: point2D(this.width - inset, inset),
			bl: point2D(inset, this.height - inset),
			br: point2D(this.width - inset, this.height - inset)
		}[corner];
	}

	/** The point a corner travels to when the page turns right over — well off the page. */
	private c2(corner: CornerName): Point2D {
		return {
			tl: point2D(this.width * 2, 0),
			tr: point2D(-this.width, 0),
			bl: point2D(this.width * 2, this.height),
			br: point2D(-this.width, this.height)
		}[corner];
	}

	/** The page element that shows as the underside of the fold. */
	private foldingPage(): HTMLElement | null {
		if (this.options.folding) return this.options.folding;

		if (this.host.display() === 'single') {
			return this.host.pageObj(this.options.next) ? this.host.pageObj(0) ?? null : null;
		}

		return this.host.pageObj(this.options.next) ?? null;
	}

	/**
	 * Whether this page casts a shadow onto the page behind it. The two pages either side of the
	 * spine's outermost leaves have nothing behind them, so turn.js skips them.
	 */
	private backGradient(): boolean {
		const wanted =
			this.options.backGradient &&
			(this.host.display() === 'single' ||
				(this.options.page !== 2 && this.options.page !== this.host.totalPages() - 1));

		if (wanted && !this.bshadow) {
			const shadow = document.createElement('div');
			Object.assign(shadow.style, {
				top: '0',
				left: '0',
				overflow: 'hidden',
				zIndex: '1',
				width: `${this.width}px`,
				height: `${this.height}px`
			});
			this.parent.append(shadow);
			this.bshadow = shadow;
		}

		return wanted;
	}

	resize(full = false) {
		this.width = this.element.offsetWidth;
		this.height = this.element.offsetHeight;

		const size = Math.round(Math.sqrt(Math.pow(this.width, 2) + Math.pow(this.height, 2)));

		if (full) {
			Object.assign(this.wrapper.style, { width: `${size}px`, height: `${size}px` });
			Object.assign(this.fwrapper.style, { width: `${size}px`, height: `${size}px` });
			Object.assign(this.fpageParent.style, {
				width: `${this.width}px`,
				height: `${this.height}px`
			});
			// The underside is the page rotated a quarter turn, so its box is the page transposed.
			Object.assign(this.fpage.style, { width: `${this.height}px`, height: `${this.width}px` });

			if (this.options.frontGradient && this.ashadow) {
				Object.assign(this.ashadow.style, {
					width: `${this.height}px`,
					height: `${this.width}px`
				});
			}

			if (this.backGradient() && this.bshadow) {
				Object.assign(this.bshadow.style, {
					width: `${this.width}px`,
					height: `${this.height}px`
				});
			}
		}

		if (this.parent.offsetParent !== null) {
			const parentOffset = offset(this.parent);
			this.fwrapper.style.top = `${parentOffset.y}px`;
			this.fwrapper.style.left = `${parentOffset.x}px`;

			const bookOffset = offset(this.host.element);
			const foldParent = this.host.foldParent();
			foldParent.style.top = `${-bookOffset.y}px`;
			foldParent.style.left = `${-bookOffset.x}px`;
		}

		this.z(this.options.zIndex ?? null);
	}

	/** `_addPageWrapper`: builds the boxes the fold is clipped by. */
	private addPageWrapper() {
		const parent = this.element.parentElement;
		if (!parent) throw new Error('A turn.js page must be inside a page wrapper');

		this.parent = parent;
		this.width = this.element.offsetWidth;
		this.height = this.element.offsetHeight;

		Object.assign(this.element.style, {
			position: 'absolute',
			top: '0',
			left: '0',
			bottom: 'auto',
			right: 'auto'
		});

		this.wrapper = document.createElement('div');
		Object.assign(this.wrapper.style, {
			position: 'absolute',
			top: '0',
			left: '0',
			overflow: 'hidden',
			zIndex: this.element.style.zIndex || 'auto'
		});
		parent.append(this.wrapper);
		this.wrapper.prepend(this.element);

		this.fwrapper = document.createElement('div');
		Object.assign(this.fwrapper.style, {
			position: 'absolute',
			top: '0',
			left: '0',
			overflow: 'hidden',
			display: 'none'
		});
		this.host.foldParent().append(this.fwrapper);

		this.fpageParent = document.createElement('div');
		Object.assign(this.fpageParent.style, {
			position: 'absolute',
			top: '0',
			left: '0',
			overflow: 'visible',
			zIndex: '0'
		});
		this.fwrapper.append(this.fpageParent);

		this.fpage = document.createElement('div');
		this.fpage.style.cursor = 'default';
		this.fpageParent.append(this.fpage);

		if (this.options.frontGradient) {
			this.ashadow = document.createElement('div');
			Object.assign(this.ashadow.style, {
				position: 'absolute',
				top: '0',
				left: '0',
				overflow: 'hidden',
				zIndex: '1'
			});
			this.fpage.append(this.ashadow);
		}

		this.resize(true);
	}

	/**
	 * `_fold`: takes the dragged point and lays every layer out for it.
	 *
	 * `compute` solves the fold triangle — `alpha` is the crease angle, `tr` the translation that
	 * pins the crease to the corner, `df` where the underside lands, `mv` the correction once the
	 * crease passes the vertical. `transform` then applies that to the four boxes at once.
	 */
	private fold(point: FoldPoint) {
		const that = this;
		const width = this.width;
		const height = this.height;
		const folding = this.foldingPage();
		const ac = this.options.acceleration;
		const h = this.wrapper.offsetHeight;
		const o = this.c(point.corner);
		const top = point.corner.charAt(0) === 't';
		const left = point.corner.charAt(1) === 'l';

		let a = 0;
		let alpha = 0;
		let px = 0;
		let gradientEndPointA = point2D(0, 0);
		let gradientEndPointB = point2D(0, 0);
		let gradientStartV = 0;
		let gradientSize = 0;
		let gradientOpacity = 0;
		let mv = point2D(0, 0);
		let df = point2D(0, 0);
		let tr = point2D(0, 0);
		let tan = 0;

		if (!folding) return;

		const compute = (): boolean => {
			const rel = point2D(o.x ? o.x - point.x : point.x, o.y ? o.y - point.y : point.y);
			tan = Math.atan2(rel.y, rel.x);

			alpha = A90 - tan;
			a = deg(alpha);

			const middle = point2D(left ? width - rel.x / 2 : point.x + rel.x / 2, rel.y / 2);
			const gamma = alpha - Math.atan2(middle.y, middle.x);
			const distance = Math.max(
				0,
				Math.sin(gamma) * Math.sqrt(Math.pow(middle.x, 2) + Math.pow(middle.y, 2))
			);

			tr = point2D(distance * Math.sin(alpha), distance * Math.cos(alpha));

			if (alpha > A90) {
				tr.x = tr.x + Math.abs(tr.y * Math.tan(tan));
				tr.y = 0;

				// The crease has gone past the far edge; pull the point back onto the page and redo.
				if (Math.round(tr.x * Math.tan(PI - alpha)) < height) {
					point.y = Math.sqrt(Math.pow(height, 2) + 2 * middle.x * rel.x);
					if (top) point.y = height - point.y;

					return compute();
				}
			}

			if (alpha > A90) {
				const beta = PI - alpha;
				const dd = h - height / Math.sin(beta);
				mv = point2D(Math.round(dd * Math.cos(beta)), Math.round(dd * Math.sin(beta)));
				if (left) mv.x = -mv.x;
				if (top) mv.y = -mv.y;
			}

			px = Math.round(tr.y / Math.tan(alpha) + tr.x);

			const side = width - px;
			const sideX = side * Math.cos(alpha * 2);
			const sideY = side * Math.sin(alpha * 2);
			df = point2D(
				Math.round(left ? side - sideX : px + sideX),
				Math.round(top ? sideY : height - sideY)
			);

			// Gradients
			gradientSize = side * Math.sin(alpha);

			const endingPoint = that.c2(point.corner);
			const far = Math.sqrt(
				Math.pow(endingPoint.x - point.x, 2) + Math.pow(endingPoint.y - point.y, 2)
			);

			gradientOpacity = far < width ? far / width : 1;

			if (that.options.frontGradient) {
				gradientStartV = gradientSize > 100 ? (gradientSize - 100) / gradientSize : 0;
				gradientEndPointA = point2D(
					((gradientSize * Math.sin(A90 - alpha)) / height) * 100,
					((gradientSize * Math.cos(A90 - alpha)) / width) * 100
				);

				if (top) gradientEndPointA.y = 100 - gradientEndPointA.y;
				if (left) gradientEndPointA.x = 100 - gradientEndPointA.x;
			}

			if (that.backGradient()) {
				gradientEndPointB = point2D(
					((gradientSize * Math.sin(alpha)) / width) * 100,
					((gradientSize * Math.cos(alpha)) / height) * 100
				);
				if (!left) gradientEndPointB.x = 100 - gradientEndPointB.x;
				if (!top) gradientEndPointB.y = 100 - gradientEndPointB.y;
			}

			tr.x = Math.round(tr.x);
			tr.y = Math.round(tr.y);

			return true;
		};

		const transform = (
			trans: Point2D,
			c: [number, number, number, number],
			x: [number, number],
			angle: number
		) => {
			const f = ['0', 'auto'];
			const mvW = ((width - h) * x[0]) / 100;
			const mvH = ((height - h) * x[1]) / 100;
			const v = { left: f[c[0]], top: f[c[1]], right: f[c[2]], bottom: f[c[3]] };
			// A whole-degree rotation lands a page edge exactly on a device pixel, where the
			// browser's antialiasing leaves a seam; turn.js nudges it a pixel off.
			const aliasingFk = angle !== 90 && angle !== -90 ? (left ? -1 : 1) : 0;
			const origin = `${x[0]}% ${x[1]}%`;

			Object.assign(that.element.style, v);
			setTransform(
				that.element,
				rotate(angle) + translate(trans.x + aliasingFk, trans.y, ac),
				origin
			);

			Object.assign(that.fpageParent.style, v);

			setTransform(
				that.wrapper,
				translate(-trans.x + mvW - aliasingFk, -trans.y + mvH, ac) + rotate(-angle),
				origin
			);

			setTransform(
				that.fwrapper,
				translate(-trans.x + mv.x + mvW, -trans.y + mv.y + mvH, ac) + rotate(-angle),
				origin
			);

			setTransform(
				that.fpageParent,
				rotate(angle) + translate(trans.x + df.x - mv.x, trans.y + df.y - mv.y, ac),
				origin
			);

			if (that.options.frontGradient && that.ashadow) {
				gradient(
					that.ashadow,
					height,
					width,
					point2D(left ? 100 : 0, top ? 100 : 0),
					point2D(gradientEndPointA.x, gradientEndPointA.y),
					[
						[gradientStartV, 'rgba(0,0,0,0)'],
						[(1 - gradientStartV) * 0.8 + gradientStartV, `rgba(0,0,0,${0.2 * gradientOpacity})`],
						[1, `rgba(255,255,255,${0.2 * gradientOpacity})`]
					]
				);
			}

			if (that.backGradient() && that.bshadow) {
				gradient(
					that.bshadow,
					width,
					height,
					point2D(left ? 0 : 100, top ? 0 : 100),
					point2D(gradientEndPointB.x, gradientEndPointB.y),
					[
						[0.8, 'rgba(0,0,0,0)'],
						[1, `rgba(0,0,0,${0.3 * gradientOpacity})`],
						[1, 'rgba(0,0,0,0)']
					]
				);
			}
		};

		switch (point.corner) {
			case 'tl':
				point.x = Math.max(point.x, 1);
				compute();
				transform(tr, [1, 0, 0, 1], [100, 0], a);
				setTransform(
					this.fpage,
					translate(-height, -width, ac) + rotate(90 - a * 2),
					'100% 100%'
				);
				setTransform(folding, rotate(90) + translate(0, -height, ac), '0% 0%');
				break;
			case 'tr':
				point.x = Math.min(point.x, width - 1);
				compute();
				transform(point2D(-tr.x, tr.y), [0, 0, 0, 1], [0, 0], -a);
				setTransform(this.fpage, translate(0, -width, ac) + rotate(-90 + a * 2), '0% 100%');
				setTransform(folding, rotate(270) + translate(-width, 0, ac), '0% 0%');
				break;
			case 'bl':
				point.x = Math.max(point.x, 1);
				compute();
				transform(point2D(tr.x, -tr.y), [1, 1, 0, 0], [100, 100], -a);
				setTransform(this.fpage, translate(-height, 0, ac) + rotate(-90 + a * 2), '100% 0%');
				setTransform(folding, rotate(270) + translate(-width, 0, ac), '0% 0%');
				break;
			case 'br':
				point.x = Math.min(point.x, width - 1);
				compute();
				transform(point2D(-tr.x, -tr.y), [0, 1, 1, 0], [0, 100], a);
				setTransform(this.fpage, rotate(90 - a * 2), '0% 0%');
				setTransform(folding, rotate(90) + translate(0, -height, ac), '0% 0%');
				break;
		}

		this.point = point;
	}

	/** Moves the next page into the folded layer, or hands it back to where it came from. */
	moveFoldingPage(into: boolean) {
		const folding = this.foldingPage();
		if (!folding) return;

		if (into) {
			const occupied = this.fpage.children[this.ashadow ? 1 : 0];
			if (!occupied) {
				this.backParent = folding.parentElement;
				this.fpage.prepend(folding);
			}
		} else if (this.backParent) {
			this.backParent.prepend(folding);
		}
	}

	private showFoldedPage(c: FoldPoint, animate = false): boolean {
		const folding = this.foldingPage();

		if (!this.point || this.point.corner !== c.corner) {
			if (this.callbacks.start?.(this.options, c.corner) === false) return false;
		}

		if (!folding) return false;

		if (animate) {
			const point =
				this.point && this.point.corner === c.corner ? this.point : this.c(c.corner, 1);

			this.effect = animatef(this.effect, {
				from: [point.x, point.y],
				to: [c.x, c.y],
				duration: 500,
				frame: (v) => {
					c.x = Math.round(v[0]);
					c.y = Math.round(v[1]);
					this.fold(c);
				}
			});
		} else {
			this.fold(c);
			const running = this.activeEffect();
			if (running && !running.turning) this.effect = animatef(this.effect, false);
		}

		if (this.fwrapper.style.display === 'none') {
			const foldParent = this.host.foldParent();
			foldParent.style.display = '';
			foldParent.dataset.flips = String(Number(foldParent.dataset.flips ?? 0) + 1);
			this.moveFoldingPage(true);
			this.fwrapper.style.display = '';
			if (this.bshadow) this.bshadow.style.display = '';
		}

		return true;
	}

	/** `flip('hide')`: puts every layer back the way it was found. */
	hide(): this {
		const folding = this.foldingPage();
		const foldParent = this.host.foldParent();
		const flips = Number(foldParent.dataset.flips ?? 0) - 1;

		foldParent.dataset.flips = String(Math.max(0, flips));
		if (flips <= 0) foldParent.style.display = 'none';

		Object.assign(this.element.style, { left: '0', top: '0', right: 'auto', bottom: 'auto' });
		setTransform(this.element, '', '0% 100%');
		setTransform(this.wrapper, '', '0% 100%');

		this.fwrapper.style.display = 'none';
		if (this.bshadow) this.bshadow.style.display = 'none';
		if (folding) setTransform(folding, '', '0% 0%');

		return this;
	}

	hideFoldedPage(animate = false) {
		if (!this.point) return;

		const p1 = this.point;
		const hide = () => {
			this.point = null;
			this.hide();
			this.callbacks.end?.(false);
		};

		if (animate) {
			const p4 = this.c(p1.corner);
			const top = p1.corner.charAt(0) === 't';
			const delta = top ? Math.min(0, p1.y - p4.y) / 2 : Math.max(0, p1.y - p4.y) / 2;
			const p2 = point2D(p1.x, p1.y + delta);
			const p3 = point2D(p4.x, p4.y - delta);

			this.effect = animatef(this.effect, {
				from: 0,
				to: 1,
				duration: 800,
				hiding: true,
				frame: (v) => {
					const np = bezier(p1, p2, p3, p4, v);
					p1.x = np.x;
					p1.y = np.y;
					this.fold(p1);
				},
				complete: hide
			});
		} else {
			this.effect = animatef(this.effect, false);
			hide();
		}
	}

	/** `flip('turnPage')`: carries the corner all the way over to the far side of the book. */
	turnPage(corner?: CornerName) {
		const target: FoldPoint = {
			corner: this.corner ? this.corner.corner : corner ?? this.allowedCorners()[0],
			x: 0,
			y: 0
		};

		const p1 = this.point ?? this.c(target.corner, this.host.elevation());
		const p4 = this.c2(target.corner);

		this.callbacks.flip?.();

		this.effect = animatef(this.effect, {
			from: 0,
			to: 1,
			duration: this.options.duration,
			turning: true,
			frame: (v) => {
				const np = bezier(p1, p1, p4, p4, v);
				target.x = np.x;
				target.y = np.y;
				this.showFoldedPage(target);
			},
			complete: () => {
				this.callbacks.end?.(true);
			}
		});

		this.corner = null;
	}

	moving(): boolean {
		return this.activeEffect() !== undefined;
	}

	isTurning(): boolean {
		return this.activeEffect()?.turning === true;
	}

	stopAnimation() {
		this.effect = animatef(this.effect, false);
	}

	disable(disable: boolean | number) {
		this.disabled = disable;
	}

	/** The corner the pointer is in, or false. Ported from `_cornerActivated`. */
	private cornerActivated(event: PointerEvent | MouseEvent): FoldPoint | false {
		const pos = offset(this.parent);
		const pageX = event.clientX + window.pageXOffset;
		const pageY = event.clientY + window.pageYOffset;
		const c = { x: Math.max(0, pageX - pos.x), y: Math.max(0, pageY - pos.y), corner: '' };
		const csz = this.options.cornerSize;

		if (c.x <= 0 || c.y <= 0 || c.x >= this.width || c.y >= this.height) return false;

		if (c.y < csz) c.corner = 't';
		else if (c.y >= this.height - csz) c.corner = 'b';
		else return false;

		if (c.x <= csz) c.corner += 'l';
		else if (c.x >= this.width - csz) c.corner += 'r';
		else return false;

		return this.allowedCorners().includes(c.corner as CornerName)
			? (c as FoldPoint)
			: false;
	}

	/** Returns false to ask the book to swallow the event, as turn.js's `_eventStart` did. */
	eventStart(event: PointerEvent): boolean | undefined {
		if (!this.disabled && !this.isTurning()) {
			const activated = this.cornerActivated(event);
			this.corner = activated || null;

			if (this.corner && this.foldingPage()) {
				this.moveFoldingPage(true);
				this.callbacks.pressed?.();

				return false;
			}

			this.corner = null;
		}

		return undefined;
	}

	eventMove(event: PointerEvent) {
		if (this.disabled) return;

		if (this.corner) {
			const pos = offset(this.parent);
			this.corner.x = event.clientX + window.pageXOffset - pos.x;
			this.corner.y = event.clientY + window.pageYOffset - pos.y;
			this.showFoldedPage(this.corner);
		} else if (!this.activeEffect() && this.element.offsetParent !== null) {
			// Roll over: the corner lifts a little on its own to say it can be dragged.
			const activated = this.cornerActivated(event);

			if (activated) {
				const origin = this.c(activated.corner, this.options.cornerSize / 2);
				activated.x = origin.x;
				activated.y = origin.y;
				this.showFoldedPage(activated, true);
			} else {
				this.hideFoldedPage(true);
			}
		}
	}

	eventEnd() {
		if (!this.disabled && this.point) {
			if (this.callbacks.released?.(this.point) !== false) this.hideFoldedPage(true);
		}

		this.corner = null;
	}

	/** Unwinds every box this flip built, leaving the page element where it was found. */
	destroy() {
		this.stopAnimation();
		this.moveFoldingPage(false);
		this.fwrapper.remove();
		this.bshadow?.remove();

		setTransform(this.element, '', '');
		Object.assign(this.element.style, {
			position: '',
			top: '',
			left: '',
			right: '',
			bottom: ''
		});

		this.parent.append(this.element);
		this.wrapper.remove();
	}
}
