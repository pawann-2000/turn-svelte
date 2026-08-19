/**
 * The book, ported from turn.js's `turnMethods` (Emmanuel Garcia, 3rd release).
 *
 * turn.js owns its pages: it wraps each one, stacks them by z-index around the current view, and
 * hands the two pages either side of the spine to a `Flip` so they can be dragged over. That is
 * all kept. The one thing this port does differently is that it never deletes a page element —
 * Svelte owns those, so pages outside the view are hidden rather than evicted from the DOM.
 */

import { Flip, type FlipOptions, type FoldPoint } from './flip.js';
import type { CornerName } from './geometry.js';
import type {
	TurnBookApi,
	TurnBookCallbacks,
	TurnBookEvent,
	TurnBookEventType,
	TurnBookOptions,
	TurnCorners,
	TurnDisplay,
	TurnSize
} from './types.js';

/** turn.js keeps the wrappers of a spread pinned to opposite edges. */
const pagePosition: Record<number, Record<string, string>> = {
	0: { top: '0', left: '0', right: 'auto', bottom: 'auto' },
	1: { top: '0', right: '0', left: 'auto', bottom: 'auto' }
};

const displays: TurnDisplay[] = ['single', 'double'];

interface EngineOptions {
	page: number;
	pages?: number;
	width: number;
	height: number;
	gradients: boolean;
	duration: number;
	acceleration: boolean;
	display: TurnDisplay;
	cornerSize: number;
	corners?: TurnCorners;
	elevation: number;
}

const defaults: Omit<EngineOptions, 'width' | 'height'> = {
	page: 1,
	gradients: true,
	duration: 600,
	acceleration: true,
	display: 'double',
	cornerSize: 100,
	elevation: 0
};

function toNumber(value: number | undefined, fallback: number, minimum = 0): number {
	const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;

	return Math.max(minimum, Math.round(numeric));
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(Math.max(value, minimum), maximum);
}

class TurnBook implements TurnBookApi {
	readonly element: HTMLElement;

	private opts: EngineOptions;
	private readonly callbacks: TurnBookCallbacks;

	private pageObjs = new Map<number, HTMLElement>();
	private flips = new Map<number, Flip>();
	private pageWrap = new Map<number, HTMLElement>();
	private pagePlace = new Map<number, number>();
	private wrapperOf = new WeakMap<HTMLElement, HTMLElement>();
	private pageMv: number[] = [];

	private totalPagesValue = 0;
	private currentPage = 1;
	private tpage: number | undefined;
	private displayValue: TurnDisplay = 'double';
	private disabledValue = false;
	private done = false;
	private destroyed = false;
	private pressedAt = 0;

	private fparent!: HTMLElement;
	private temporal?: HTMLElement;
	private observer?: MutationObserver;
	private restore: { position: string; width: string; height: string; overflow: string };

	constructor(element: HTMLElement, options: TurnBookOptions, callbacks: TurnBookCallbacks = {}) {
		this.element = element;
		this.callbacks = callbacks;
		this.restore = {
			position: element.style.position,
			width: element.style.width,
			height: element.style.height,
			overflow: element.style.overflow
		};

		this.opts = {
			...defaults,
			width: toNumber(options.width, element.clientWidth || 800, 1),
			height: toNumber(options.height, element.clientHeight || 500, 1),
			...(typeof options.page === 'number' ? { page: options.page } : {}),
			...(typeof options.pages === 'number' ? { pages: options.pages } : {}),
			...(typeof options.gradients === 'boolean' ? { gradients: options.gradients } : {}),
			...(typeof options.duration === 'number' ? { duration: options.duration } : {}),
			...(typeof options.cornerSize === 'number' ? { cornerSize: options.cornerSize } : {}),
			...(options.corners ? { corners: options.corners } : {}),
			...(options.display ? { display: options.display } : {})
		};

		this.totalPagesValue = this.opts.pages ?? 0;

		Object.assign(element.style, {
			position: 'relative',
			width: `${this.opts.width}px`,
			height: `${this.opts.height}px`
		});

		this.createFoldParent();
		this.display(this.opts.display);

		const children = [...element.children].filter(
			(child): child is HTMLElement => child instanceof HTMLElement && child !== this.fparent
		);
		children.forEach((child, index) => this.addPage(child, index + 1));

		this.page(this.opts.page);

		element.addEventListener('pointerdown', this.handlePointerDown);
		document.addEventListener('pointermove', this.handlePointerMove);
		document.addEventListener('pointerup', this.handlePointerUp);
		document.addEventListener('pointercancel', this.handlePointerUp);

		// A page is a grandchild once it is wrapped, so a removal has to be caught in the subtree.
		// Everything else inside a page is the consumer's business and is ignored.
		this.observer = new MutationObserver((records) => {
			for (const record of records) {
				if (record.target === element) return this.syncPages();

				for (const node of record.removedNodes) {
					if (node instanceof HTMLElement && this.isPageElement(node)) return this.syncPages();
				}
			}
		});
		this.observer.observe(element, { childList: true, subtree: true });

		this.done = true;
	}

	// ---------------------------------------------------------------- events

	private emit(type: TurnBookEventType, page = this.currentPage, view = this.view(page), corner?: string, originalEvent?: Event) {
		const event: TurnBookEvent = { type, api: this, page, view, originalEvent, corner };
		this.callbacks[type]?.(event);
	}

	private handlePointerDown = (event: PointerEvent) => {
		if (this.destroyed) return;

		for (const flip of this.flips.values()) {
			if (flip.eventStart(event) === false) {
				event.preventDefault();

				return;
			}
		}
	};

	private handlePointerMove = (event: PointerEvent) => {
		if (this.destroyed) return;
		for (const flip of this.flips.values()) flip.eventMove(event);
	};

	private handlePointerUp = () => {
		if (this.destroyed) return;
		for (const flip of this.flips.values()) flip.eventEnd();
	};

	// ------------------------------------------------------------ page setup

	private createFoldParent() {
		const fparent = document.createElement('div');
		Object.assign(fparent.style, {
			position: 'absolute',
			top: '0',
			left: '0',
			overflow: 'visible',
			zIndex: 'auto',
			pointerEvents: 'none',
			display: 'none'
		});
		fparent.dataset.turnFoldParent = '';
		fparent.dataset.flips = '0';
		this.element.append(fparent);
		this.fparent = fparent;
	}

	hasPage(page: number): boolean {
		return this.pageObjs.has(page);
	}

	private isPageElement(node: HTMLElement): boolean {
		for (const element of this.pageObjs.values()) if (element === node) return true;

		return false;
	}

	addPage(element: HTMLElement, page?: number) {
		const lastPage = this.totalPagesValue + 1;
		let target = page ?? lastPage;
		let incPages = page === undefined || page === lastPage;

		if (page !== undefined && page > lastPage) {
			throw new Error(
				`It is impossible to add the page "${page}", the maximum value is: "${lastPage}"`
			);
		}

		if (target < 1 || target > lastPage) return;

		if (this.done) this.stop();
		if (this.pageObjs.has(target)) this.movePages(target, 1);
		if (incPages) this.totalPagesValue = lastPage;

		element.classList.add('turn-page', `p${target}`);
		this.pageObjs.set(target, element);
		this.internalAddPage(target);

		if (this.done) this.update();
	}

	/** `_addPage`: gives a page its wrapper, and a flip if it is in the current view. */
	private internalAddPage(page: number) {
		const element = this.pageObjs.get(page);
		if (!element) return;

		if (!this.pageWrap.has(page)) {
			const pageWidth = this.displayValue === 'double' ? this.opts.width / 2 : this.opts.width;
			const pageHeight = this.opts.height;

			Object.assign(element.style, { width: `${pageWidth}px`, height: `${pageHeight}px` });
			this.pagePlace.set(page, page);

			const wrap = document.createElement('div');
			wrap.className = 'turn-page-wrapper';
			wrap.dataset.page = String(page);
			Object.assign(wrap.style, {
				position: 'absolute',
				overflow: 'hidden',
				width: `${pageWidth}px`,
				height: `${pageHeight}px`
			});
			Object.assign(wrap.style, pagePosition[this.displayValue === 'double' ? page % 2 : 0]);

			this.element.append(wrap);
			wrap.prepend(element);
			this.pageWrap.set(page, wrap);
			this.wrapperOf.set(wrap, element);
		}

		if (!page || this.setPageLoc(page) === 1) this.makeFlip(page);
	}

	/** `_makeFlip`: the two pages either side of the spine are the ones that can be dragged. */
	private makeFlip(page: number): Flip | undefined {
		if (this.flips.has(page) || this.pagePlace.get(page) !== page) return this.flips.get(page);

		const element = this.pageObjs.get(page);
		if (!element) return undefined;

		const single = this.displayValue === 'single';
		const even = page % 2;

		Object.assign(element.style, {
			width: `${single ? this.opts.width : this.opts.width / 2}px`,
			height: `${this.opts.height}px`
		});

		const options: FlipOptions = {
			page,
			next: single && page === this.totalPagesValue ? page - 1 : even || single ? page + 1 : page - 1,
			duration: this.opts.duration,
			acceleration: this.opts.acceleration,
			cornerSize: this.opts.cornerSize,
			corners: this.opts.corners ?? (single ? 'all' : even ? 'forward' : 'backward'),
			backGradient: this.opts.gradients,
			frontGradient: this.opts.gradients
		};

		const flip: Flip = new Flip(
			element,
			options,
			{
				element: this.element,
				display: () => this.displayValue,
				totalPages: () => this.totalPagesValue,
				pageObj: (target) => (target === 0 ? this.temporal : this.pageObjs.get(target)),
				foldParent: () => this.fparent,
				elevation: () => this.opts.elevation
			},
			{
				start: (opts, corner) => this.onStart(flip, opts, corner),
				pressed: () => this.onPressed(flip),
				released: (point) => this.onReleased(flip, point),
				end: (turned) => this.onEnd(flip, turned),
				flip: () => this.emit('turn', flip.options.next, this.view(flip.options.next))
			}
		);

		flip.disable(this.disabledValue);
		this.flips.set(page, flip);

		return flip;
	}

	private makeRange() {
		const [from, to] = this.range();
		for (let page = from; page <= to; page++) this.internalAddPage(page);
	}

	range(page = this.tpage ?? this.currentPage): [number, number] {
		const pagesInDOM = 6;
		const view = this.internalView(page);
		let left: number;
		let right: number;

		if (page < 1 || page > this.totalPagesValue) {
			throw new Error(`"${page}" is not a page for range`);
		}

		view[1] = view[1] || view[0];

		if (view[0] >= 1 && view[1] <= this.totalPagesValue) {
			const remainingPages = Math.floor((pagesInDOM - 2) / 2);

			if (this.totalPagesValue - view[1] > view[0]) {
				left = Math.min(view[0] - 1, remainingPages);
				right = 2 * remainingPages - left;
			} else {
				right = Math.min(this.totalPagesValue - view[1], remainingPages);
				left = 2 * remainingPages - right;
			}
		} else {
			left = pagesInDOM - 1;
			right = pagesInDOM - 1;
		}

		return [Math.max(1, view[0] - left), Math.min(this.totalPagesValue, view[1] + right)];
	}

	removePage(page: number) {
		if (!this.pageObjs.has(page)) return;

		this.stop();
		this.removePageFromDOM(page);
		this.pageObjs.delete(page);
		this.movePages(page, -1);
		this.totalPagesValue -= 1;
		this.makeRange();

		if (this.currentPage > this.totalPagesValue) this.page(this.totalPagesValue);
	}

	private removePageFromDOM(page: number) {
		const flip = this.flips.get(page);

		if (flip) {
			flip.destroy();
			this.flips.delete(page);
		}

		const wrap = this.pageWrap.get(page);

		if (wrap) {
			// The page element belongs to the caller; only the wrapping goes.
			const element = this.pageObjs.get(page);
			if (element && element.parentElement) element.remove();
			wrap.remove();
			this.pageWrap.delete(page);
		}

		this.pagePlace.delete(page);
	}

	/** `_movePages`: renumbers pages after one is inserted or taken out. */
	private movePages(from: number, change: number) {
		const single = this.displayValue === 'single';
		const move = (page: number) => {
			const next = page + change;
			const odd = next % 2;
			const element = this.pageObjs.get(page);

			if (element) {
				element.classList.remove(`page${page}`);
				element.classList.add(`page${next}`);
				this.pageObjs.set(next, element);
			}

			const wrap = this.pageWrap.get(page);

			if (this.pagePlace.get(page) && wrap) {
				this.pagePlace.set(next, next);
				Object.assign(wrap.style, pagePosition[single ? 0 : odd]);
				wrap.dataset.page = String(next);
				this.pageWrap.set(next, wrap);

				const flip = this.flips.get(page);

				if (flip) {
					flip.setOptions({
						page: next,
						next: single || odd ? next + 1 : next - 1,
						corners: single ? 'all' : odd ? 'forward' : 'backward'
					});
					this.flips.set(next, flip);
				}

				if (change) {
					this.flips.delete(page);
					this.pagePlace.delete(page);
					this.pageObjs.delete(page);
					this.pageWrap.delete(page);
				}
			}
		};

		if (change > 0) for (let page = this.totalPagesValue; page >= from; page--) move(page);
		else for (let page = from; page <= this.totalPagesValue; page++) move(page);
	}

	/**
	 * Rebuilds the page list after Svelte adds or removes children. turn.js never had to do this;
	 * its pages were its own.
	 */
	private syncPages() {
		if (this.destroyed) return;

		const ordered: HTMLElement[] = [];

		for (const child of [...this.element.children]) {
			if (!(child instanceof HTMLElement)) continue;
			if (child === this.fparent || child === this.temporal) continue;

			const wrapped = this.wrapperOf.get(child);

			if (wrapped) {
				if (wrapped.isConnected) ordered.push(wrapped);
				else child.remove();

				continue;
			}

			ordered.push(child);
		}

		const current: HTMLElement[] = [];
		for (let page = 1; page <= this.totalPagesValue; page++) {
			const element = this.pageObjs.get(page);
			if (element) current.push(element);
		}

		const unchanged =
			current.length === ordered.length && current.every((element, i) => element === ordered[i]);
		if (unchanged) return;

		this.stop();
		for (const page of [...this.pageWrap.keys()]) this.removePageFromDOM(page);
		this.pageObjs.clear();
		this.pagePlace.clear();

		this.totalPagesValue = ordered.length;
		ordered.forEach((element, index) => {
			this.pageObjs.set(index + 1, element);
			this.internalAddPage(index + 1);
		});

		this.currentPage = clamp(this.currentPage, 1, Math.max(1, this.totalPagesValue));
		this.makeRange();
		this.update();
	}

	// ------------------------------------------------------------- display

	display(display?: TurnDisplay): TurnDisplay {
		const currentDisplay = this.displayValue;

		if (!display) return currentDisplay;
		if (!displays.includes(display)) throw new Error(`"${display}" is not a value for display`);

		if (display === 'single') {
			if (!this.temporal) {
				this.stop();
				this.element.style.overflow = 'hidden';
				const temporal = document.createElement('div');
				temporal.className = 'turn-page p-temporal';
				Object.assign(temporal.style, {
					width: `${this.opts.width}px`,
					height: `${this.opts.height}px`
				});
				this.element.append(temporal);
				this.temporal = temporal;
			}
		} else if (this.temporal) {
			this.stop();
			this.element.style.overflow = '';
			this.temporal.remove();
			this.temporal = undefined;
		}

		this.displayValue = display;

		if (currentDisplay && this.done) {
			const size = this.size();
			this.movePages(1, 0);
			this.size(size.width, size.height);
			this.update();
		}

		return display;
	}

	animating(): boolean {
		return this.pageMv.length > 0;
	}

	disable(disabled = true) {
		const view = this.view();
		this.disabledValue = disabled;

		for (const [page, flip] of this.flips) {
			flip.disable(disabled ? view.indexOf(page) : false);
		}
	}

	size(width?: number, height?: number): TurnSize {
		if (width && height) {
			this.opts.width = width;
			this.opts.height = height;

			const pageWidth = this.displayValue === 'double' ? width / 2 : width;

			// Re-asserted, not just set: the host may have rewritten the style attribute wholesale.
			Object.assign(this.element.style, {
				position: 'relative',
				width: `${width}px`,
				height: `${height}px`,
				overflow: this.displayValue === 'single' ? 'hidden' : ''
			});

			if (this.temporal) {
				Object.assign(this.temporal.style, {
					width: `${pageWidth}px`,
					height: `${height}px`
				});
			}

			for (const [page, wrap] of this.pageWrap) {
				const element = this.pageObjs.get(page);
				if (element) Object.assign(element.style, { width: `${pageWidth}px`, height: `${height}px` });
				Object.assign(wrap.style, { width: `${pageWidth}px`, height: `${height}px` });
			}

			this.resize();
		}

		return { width: this.opts.width, height: this.opts.height };
	}

	resize() {
		for (const flip of this.flips.values()) flip.resize(true);
	}

	configure(options: Partial<TurnBookOptions>) {
		if (options.display && options.display !== this.displayValue) this.display(options.display);

		if (
			(typeof options.width === 'number' && options.width !== this.opts.width) ||
			(typeof options.height === 'number' && options.height !== this.opts.height)
		) {
			this.size(options.width ?? this.opts.width, options.height ?? this.opts.height);
		}

		if (typeof options.duration === 'number') this.opts.duration = options.duration;
		if (typeof options.cornerSize === 'number') this.opts.cornerSize = options.cornerSize;
		if (typeof options.gradients === 'boolean') this.opts.gradients = options.gradients;
		if (options.corners) this.opts.corners = options.corners;

		for (const flip of this.flips.values()) {
			flip.setOptions({
				duration: this.opts.duration,
				cornerSize: this.opts.cornerSize,
				frontGradient: this.opts.gradients,
				backGradient: this.opts.gradients,
				...(this.opts.corners ? { corners: this.opts.corners } : {})
			});
		}
	}

	// ---------------------------------------------------------------- views

	private internalView(page = this.currentPage): number[] {
		if (this.displayValue === 'double') return page % 2 ? [page - 1, page] : [page, page + 1];

		return [page];
	}

	view(page = this.currentPage): number[] {
		const view = this.internalView(page);

		if (this.displayValue === 'double') {
			return [view[0] > 0 ? view[0] : 0, view[1] <= this.totalPagesValue ? view[1] : 0];
		}

		return [view[0] > 0 && view[0] <= this.totalPagesValue ? view[0] : 0];
	}

	stop() {
		const moving = this.pageMv;
		this.pageMv = [];

		if (this.tpage) {
			this.currentPage = this.tpage;
			this.tpage = undefined;
		}

		for (const page of moving) {
			const flip = this.flips.get(page);
			if (!flip) continue;

			flip.moveFoldingPage(false);
			flip.hideFoldedPage();
			this.pagePlace.set(flip.options.next, flip.options.next);

			if (flip.options.force) {
				flip.setOptions({
					next: flip.options.page % 2 === 0 ? flip.options.page - 1 : flip.options.page + 1,
					force: undefined
				});
			}
		}

		this.update();
	}

	pages(pages?: number): number {
		if (typeof pages === 'number') {
			if (pages < this.totalPagesValue) {
				for (let page = pages + 1; page <= this.totalPagesValue; page++) this.removePage(page);
				if (this.currentPage > pages) this.page(pages);
			}

			this.totalPagesValue = pages;
		}

		return this.totalPagesValue;
	}

	/** `_fitPage`: lands on a page with no animation. */
	private fitPage(page: number) {
		const newView = this.view(page);

		if (this.currentPage !== page) {
			this.emit('turning', page, newView);
			if (newView.includes(1)) this.emit('first', page, newView);
			if (newView.includes(this.totalPagesValue)) this.emit('last', page, newView);
		}

		if (!this.pageObjs.has(page)) return;

		this.tpage = page;
		this.stop();
		this.makeRange();
		this.emit('turned', this.currentPage, this.view(this.currentPage));
	}

	/** `_turnPage`: hands the turn to the flip on the leading page of the current view. */
	private turnPage(page: number) {
		const view = this.view();
		const newView = this.view(page);
		let current: number | undefined;
		let next: number | undefined;

		if (this.currentPage !== page) {
			this.emit('turning', page, newView);
			if (newView.includes(1)) this.emit('first', page, newView);
			if (newView.includes(this.totalPagesValue)) this.emit('last', page, newView);
		}

		if (!this.pageObjs.has(page)) return;

		this.tpage = page;
		this.stop();
		this.makeRange();

		if (this.displayValue === 'single') {
			current = view[0];
			next = newView[0];
		} else if (view[1] && page > view[1]) {
			current = view[1];
			next = newView[0];
		} else if (view[0] && page < view[0]) {
			current = view[0];
			next = newView[1];
		}

		const flip = current === undefined ? undefined : this.flips.get(current);

		if (flip && next !== undefined) {
			this.tpage = next;

			if (flip.options.next !== next) {
				flip.setOptions({ next, force: true });
				this.pagePlace.set(next, flip.options.page);
			}

			if (this.displayValue === 'single') {
				flip.turnPage(newView[0] > view[0] ? 'br' : 'bl');
			} else {
				flip.turnPage();
			}
		}
	}

	page(page?: number): number {
		if (typeof page !== 'number') return this.currentPage;

		const target = Number.parseInt(String(page), 10);

		if (target > 0 && target <= this.totalPagesValue) {
			if (!this.done || this.view().includes(target)) this.fitPage(target);
			else this.turnPage(target);
		}

		return this.currentPage;
	}

	next(): number {
		return this.page(this.internalView(this.currentPage).pop()! + 1);
	}

	previous(): number {
		return this.page(this.internalView(this.currentPage).shift()! - 1);
	}

	// -------------------------------------------------------- flip callbacks

	private addMotionPage(flip: Flip) {
		flip.setOptions({ pageMv: flip.options.page });
		this.removeMv(flip.options.page);
		this.pageMv.push(flip.options.page);
		this.pagePlace.set(flip.options.next, flip.options.page);
		this.update();
	}

	private removeMv(page: number): boolean {
		const index = this.pageMv.indexOf(page);
		if (index === -1) return false;
		this.pageMv.splice(index, 1);

		return true;
	}

	private onStart(flip: Flip, options: FlipOptions, corner: CornerName): false | undefined {
		let prevented = false;
		const event: TurnBookEvent = {
			type: 'start',
			api: this,
			page: options.page,
			view: this.view(options.page),
			corner,
			preventDefault: () => {
				prevented = true;
			}
		};

		this.callbacks.start?.(event);
		if (prevented) return false;

		if (this.displayValue === 'single') {
			const left = corner.charAt(1) === 'l';

			if ((options.page === 1 && left) || (options.page === this.totalPagesValue && !left)) {
				return false;
			}

			if (left) {
				flip.setOptions({
					next: options.next < options.page ? options.next : options.page - 1,
					force: true
				});
			} else {
				flip.setOptions({ next: options.next > options.page ? options.next : options.page + 1 });
			}
		}

		this.addMotionPage(flip);

		return undefined;
	}

	private onPressed(flip: Flip) {
		for (const [page, other] of this.flips) {
			if (page !== flip.options.page) other.disable(true);
		}

		this.pressedAt = Date.now();
	}

	private onReleased(flip: Flip, point: FoldPoint): boolean | void {
		const pageWidth = this.displayValue === 'double' ? this.opts.width / 2 : this.opts.width;

		// A quick press, or one let go past the far edge, means "turn it" rather than "put it back".
		if (Date.now() - this.pressedAt < 200 || point.x < 0 || point.x > pageWidth) {
			this.tpage = flip.options.next;
			this.update();
			flip.turnPage();

			return false;
		}
	}

	private onEnd(flip: Flip, turned: boolean) {
		if (turned || this.tpage) {
			if (this.tpage === flip.options.next || this.tpage === flip.options.page) {
				// turn.js clears tpage before reading it back, so the landing page is always `next`.
				this.tpage = undefined;
				this.fitPage(flip.options.next);
			}
		} else {
			if (flip.options.pageMv !== undefined) this.removeMv(flip.options.pageMv);
			this.update();
		}
	}

	// -------------------------------------------------------------- z-index

	/** `calculateZ`: the stack order while pages are in motion. */
	private calculateZ(mv: number[]) {
		const view = this.view();
		const currentPage = view[0] || view[1];
		const result = {
			pageZ: {} as Record<number, number>,
			partZ: {} as Record<number, number>,
			pageV: {} as Record<number, boolean>
		};

		const addView = (page: number) => {
			const pageView = this.view(page);
			if (pageView[0]) result.pageV[pageView[0]] = true;
			if (pageView[1]) result.pageV[pageView[1]] = true;
		};

		for (const page of mv) {
			const flip = this.flips.get(page);
			if (!flip) continue;

			const nextPage = flip.options.next;
			const placePage = this.pagePlace.get(page);
			addView(page);
			addView(nextPage);

			const dpage = this.pagePlace.get(nextPage) === nextPage ? nextPage : page;
			result.pageZ[dpage] = this.totalPagesValue - Math.abs(currentPage - dpage);
			if (placePage !== undefined) {
				result.partZ[placePage] = this.totalPagesValue * 2 + Math.abs(currentPage - dpage);
			}
		}

		return result;
	}

	update() {
		if (this.pageMv.length && this.pageMv[0] !== 0) {
			const pos = this.calculateZ(this.pageMv);

			for (const [page, wrap] of this.pageWrap) {
				wrap.style.display = pos.pageV[page] ? '' : 'none';
				wrap.style.zIndex = String(pos.pageZ[page] || 0);

				const flip = this.flips.get(page);

				if (flip) {
					flip.z(pos.partZ[page] ?? null);
					if (pos.pageV[page]) flip.resize();
					if (this.tpage) flip.disable(true);
				}
			}

			return;
		}

		for (const page of this.pageWrap.keys()) {
			const pageLocation = this.setPageLoc(page);
			const flip = this.flips.get(page);

			if (flip) {
				flip.disable(this.disabledValue || pageLocation !== 1);
				flip.z(null);
			}
		}
	}

	/** `_setPageLoc`: 1 in the current view, 2 just behind it, 0 out of sight. */
	private setPageLoc(page: number): number {
		const wrap = this.pageWrap.get(page);
		if (!wrap) return 0;

		const view = this.view();

		if (page === view[0] || page === view[1]) {
			wrap.style.zIndex = String(this.totalPagesValue);
			wrap.style.display = '';

			return 1;
		}

		if (
			(this.displayValue === 'single' && page === view[0] + 1) ||
			(this.displayValue === 'double' && (page === view[0] - 2 || page === view[1] + 2))
		) {
			wrap.style.zIndex = String(this.totalPagesValue - 1);
			wrap.style.display = '';

			return 2;
		}

		wrap.style.zIndex = '0';
		wrap.style.display = 'none';

		return 0;
	}

	destroy() {
		if (this.destroyed) return;
		this.destroyed = true;

		this.observer?.disconnect();
		this.element.removeEventListener('pointerdown', this.handlePointerDown);
		document.removeEventListener('pointermove', this.handlePointerMove);
		document.removeEventListener('pointerup', this.handlePointerUp);
		document.removeEventListener('pointercancel', this.handlePointerUp);

		for (const page of [...this.pageWrap.keys()]) {
			const element = this.pageObjs.get(page);
			const flip = this.flips.get(page);
			flip?.destroy();
			this.flips.delete(page);

			const wrap = this.pageWrap.get(page);

			if (element) {
				element.classList.remove('turn-page', `p${page}`, `page${page}`);
				element.removeAttribute('style');
				this.element.append(element);
			}

			wrap?.remove();
			this.pageWrap.delete(page);
		}

		this.temporal?.remove();
		this.fparent.remove();
		Object.assign(this.element.style, this.restore);
	}
}

export async function createTurnBook(
	element: HTMLElement,
	options: TurnBookOptions,
	callbacks?: TurnBookCallbacks
): Promise<TurnBookApi> {
	const book = new TurnBook(element, options, callbacks);

	callbacks?.ready?.({ type: 'ready', api: book, page: book.page(), view: book.view() });

	return book;
}
