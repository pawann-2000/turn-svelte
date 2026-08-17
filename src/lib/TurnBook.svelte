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
		instance?.size(numericWidth, numericHeight);
	});

	$effect(() => {
		if (instance && instance.display() !== display) instance.display(display);
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
	.turn-book {
		position: relative;
		width: var(--turn-book-width);
		height: var(--turn-book-height);
		contain: layout paint;
		touch-action: none;
		user-select: none;
		perspective: calc(var(--turn-book-width) * 1.2);
		transform-style: preserve-3d;
		overflow: hidden;
	}

	.turn-book :global(.turn-page) {
		background: var(--turn-page-background, #fbf4e4);
		background-size: 100% 100%;
		box-sizing: border-box;
		overflow: hidden;
		backface-visibility: hidden;
		box-shadow: 0 0 0 1px rgb(0 0 0 / 0.08);
	}

	.turn-book :global(.turn-page--left) {
		border-right: 1px solid rgb(0 0 0 / 0.14);
	}

	.turn-book :global(.turn-page--right) {
		border-left: 1px solid rgb(255 255 255 / 0.5);
	}

	.turn-book[data-gradients='true'] :global(.turn-page--left)::after,
	.turn-book[data-gradients='true'] :global(.turn-page--right)::after {
		content: '';
		position: absolute;
		inset: 0;
		pointer-events: none;
	}

	.turn-book[data-gradients='true'] :global(.turn-page--left)::after {
		background: linear-gradient(90deg, transparent 72%, rgb(0 0 0 / 0.16));
	}

	.turn-book[data-gradients='true'] :global(.turn-page--right)::after {
		background: linear-gradient(90deg, rgb(0 0 0 / 0.12), transparent 28%);
	}

	.turn-book :global(.turn-page--leaving-forward.turn-page--right) {
		animation: turn-page-forward-out var(--turn-duration) ease-in-out both;
	}

	.turn-book :global(.turn-page--entering-forward.turn-page--left) {
		animation: turn-page-forward-in var(--turn-duration) ease-in-out both;
	}

	.turn-book :global(.turn-page--leaving-backward.turn-page--left) {
		animation: turn-page-backward-out var(--turn-duration) ease-in-out both;
	}

	.turn-book :global(.turn-page--entering-backward.turn-page--right) {
		animation: turn-page-backward-in var(--turn-duration) ease-in-out both;
	}

	.turn-book :global(.turn-page--single.turn-page--leaving-forward),
	.turn-book :global(.turn-page--single.turn-page--leaving-backward) {
		animation: turn-page-single-out var(--turn-duration) ease-in-out both;
	}

	.turn-book :global(.turn-page--single.turn-page--entering-forward),
	.turn-book :global(.turn-page--single.turn-page--entering-backward) {
		animation: turn-page-single-in var(--turn-duration) ease-in-out both;
	}

	@keyframes turn-page-forward-out {
		from {
			transform: rotateY(0deg);
			opacity: 1;
		}

		to {
			transform: rotateY(-92deg);
			opacity: 0.62;
		}
	}

	@keyframes turn-page-forward-in {
		from {
			transform: rotateY(92deg);
			opacity: 0.62;
		}

		to {
			transform: rotateY(0deg);
			opacity: 1;
		}
	}

	@keyframes turn-page-backward-out {
		from {
			transform: rotateY(0deg);
			opacity: 1;
		}

		to {
			transform: rotateY(92deg);
			opacity: 0.62;
		}
	}

	@keyframes turn-page-backward-in {
		from {
			transform: rotateY(-92deg);
			opacity: 0.62;
		}

		to {
			transform: rotateY(0deg);
			opacity: 1;
		}
	}

	@keyframes turn-page-single-out {
		from {
			transform: translateX(0);
			opacity: 1;
		}

		to {
			transform: translateX(-3%);
			opacity: 0;
		}
	}

	@keyframes turn-page-single-in {
		from {
			transform: translateX(3%);
			opacity: 0;
		}

		to {
			transform: translateX(0);
			opacity: 1;
		}
	}
</style>
