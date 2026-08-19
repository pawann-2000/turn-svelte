<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { createTurnBook } from './turn-engine.js';
	import type {
		TurnBookApi,
		TurnBookEvent,
		TurnBookOptions,
		TurnCorners,
		TurnDisplay
	} from './types.js';

	interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		children?: Snippet;
		width?: number;
		height?: number;
		page?: number;
		pages?: number;
		display?: TurnDisplay;
		gradients?: boolean;
		duration?: number;
		cornerSize?: number;
		corners?: TurnCorners;
		disabled?: boolean;
		options?: TurnBookOptions;
		api?: TurnBookApi;
		onready?: (event: TurnBookEvent) => void;
		onturn?: (event: TurnBookEvent) => void;
		onturning?: (event: TurnBookEvent) => void;
		onturned?: (event: TurnBookEvent) => void;
		onfirst?: (event: TurnBookEvent) => void;
		onlast?: (event: TurnBookEvent) => void;
		onstart?: (event: TurnBookEvent) => void;
		oniniterror?: (error: unknown) => void;
	}

	let {
		children,
		class: className = '',
		style = '',
		width = 800,
		height = 500,
		page = $bindable(1),
		pages,
		display = 'double',
		gradients = true,
		duration = 600,
		cornerSize,
		corners,
		disabled = false,
		options = {},
		api = $bindable(),
		onready,
		onturn,
		onturning,
		onturned,
		onfirst,
		onlast,
		onstart,
		oniniterror,
		...rest
	}: Props = $props();

	let element = $state<HTMLDivElement | undefined>();
	let instance = $state<TurnBookApi | undefined>();
	let ready = $state(false);

	const numericWidth = $derived(Math.max(1, Math.round(width)));
	const numericHeight = $derived(Math.max(1, Math.round(height)));
	const bookClass = $derived(['turn-book', className].filter(Boolean).join(' '));
	const bookStyle = $derived(
		`--turn-book-width: ${numericWidth}px; --turn-book-height: ${numericHeight}px; ${style ?? ''}`
	);

	function buildOptions(): TurnBookOptions {
		return {
			...options,
			width: numericWidth,
			height: numericHeight,
			page,
			display,
			gradients,
			duration,
			...(typeof pages === 'number' ? { pages } : {}),
			...(typeof cornerSize === 'number' ? { cornerSize } : {}),
			...(corners ? { corners } : {})
		};
	}

	function setInstance(book: TurnBookApi | undefined) {
		instance = book;
		api = book;
		ready = Boolean(book);
	}

	function emitTurned(event: TurnBookEvent) {
		page = event.page;
		onturned?.(event);
	}

	onMount(() => {
		let cancelled = false;

		if (!element) return;

		void createTurnBook(element, buildOptions(), {
			ready: onready,
			turn: onturn,
			turning: onturning,
			turned: emitTurned,
			first: onfirst,
			last: onlast,
			start: onstart
		})
			.then((book) => {
				if (cancelled) {
					book.destroy();
					return;
				}

				setInstance(book);

				if (disabled) {
					book.disable(true);
				}
			})
			.catch((error: unknown) => {
				oniniterror?.(error);
			});

		return () => {
			cancelled = true;
			instance?.destroy();
			setInstance(undefined);
		};
	});

	$effect(() => {
		if (!instance) return;
		if (instance.page() !== page) instance.page(page);
	});

	$effect(() => {
		instance?.configure({
			width: numericWidth,
			height: numericHeight,
			display,
			gradients,
			duration,
			...(typeof cornerSize === 'number' ? { cornerSize } : {}),
			...(corners ? { corners } : {})
		});
	});

	$effect(() => {
		if (instance && typeof pages === 'number' && instance.pages() !== pages) instance.pages(pages);
	});

	$effect(() => {
		instance?.disable(disabled);
	});

	export function next() {
		return instance?.next();
	}

	export function previous() {
		return instance?.previous();
	}

	export function goTo(nextPage: number) {
		return instance?.page(nextPage);
	}

	export function getApi() {
		return instance;
	}
</script>

<div bind:this={element} class={bookClass} style={bookStyle} data-ready={ready} {...rest}>
	{@render children?.()}
</div>

<style>
	/*
	 * turn.js draws its fold entirely with inline transforms, so there is almost nothing to style
	 * here. What matters is what must *not* be set: no `overflow` (the engine owns it, and a fold
	 * has to be free to overhang the spine), no `contain`, and no `perspective` — the fold is a
	 * flat rotation, and a perspective would shear it.
	 */
	.turn-book {
		position: relative;
		width: var(--turn-book-width);
		height: var(--turn-book-height);
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
	}

	.turn-book :global(.turn-page) {
		background: var(--turn-page-background, #fbf4e4);
		background-size: 100% 100%;
		box-sizing: border-box;
	}
</style>
