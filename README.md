# svelte-turn-page

Svelte component library for page flipping books.

The fold is a port of [turn.js](https://www.turnjs.com) (3rd release, Emmanuel Garcia) to
TypeScript and Svelte 5 — the same fold geometry, the same gradients, the same tweener. The page
lifts from a corner on hover, follows the pointer as you drag it, springs back if you let go
short, and carries over if you drag past the far edge or click.

The package exposes Svelte components only. It does not bundle jQuery, vendored browser plugins,
demo routes, or tests.

### What the port keeps, and the one thing it does not

`geometry.ts`, `animate.ts` and `flip.ts` follow turn.js function for function: `_fold`'s
`compute`/`transform`, the linear-gradient shading, the cubic beziers a corner travels along, and
`animatef`'s fixed 30ms step with its circular ease-out. `turn-engine.ts` is `turnMethods` — page
wrapping, views, ranges, `calculateZ`, single and double display.

The one deliberate difference: turn.js evicts pages from the DOM to keep only six alive, and it
owns the elements it evicts. Here Svelte owns them, so pages outside the view are hidden rather
than removed, and a `MutationObserver` re-wraps whatever Svelte adds or takes away.

## Install

```sh
npm install svelte-turn-page
```

This package expects Svelte 5 from the consuming application.

## Usage

```svelte
<script lang="ts">
	import { TurnBook, TurnPage, type TurnBookApi } from 'svelte-turn-page';

	let api: TurnBookApi | undefined;
	let page = 1;
</script>

<TurnBook bind:api bind:page width={900} height={560} display="double">
	<TurnPage>
		<h2>Cover</h2>
	</TurnPage>

	<TurnPage>
		<h2>Inside page</h2>
	</TurnPage>
</TurnBook>

<button type="button" onclick={() => api?.previous()}>Previous</button>
<button type="button" onclick={() => api?.next()}>Next</button>
```

## API

`TurnBook` props:

- `width`, `height`: fixed pixel dimensions for the book.
- `page`: bindable current page.
- `display`: `'single'` or `'double'`.
- `pages`: optional total page count for dynamic pages.
- `gradients`, `duration`, `cornerSize`, `corners`: visual and interaction options.
- `disabled`: locks or unlocks interaction.
- `api`: bindable imperative component API.
- `onready`, `onturn`, `onturning`, `onturned`, `onfirst`, `onlast`, `onstart`: Svelte 5 callback props.

Pages peel when a pointer enters an enabled corner. Press and drag to control the fold, then release to complete or cancel the turn. Keyboard and imperative turns use the same fold renderer.

`TurnBookApi` methods:

`next`, `previous`, `page`, `pages`, `view`, `range`, `size`, `display`, `configure`, `resize`, `update`, `disable`, `stop`, `animating`, `hasPage`, `addPage`, `removePage`, and `destroy`.

## Scripts

```sh
npm run check
npm run build
npm run package
npm run lint
```

`npm run build` packages the Svelte source and adds ESM/CJS TypeScript bundles with `tsdown`.
`npm run lint` runs Svelte checks, builds the library, and validates the package exports with `publint`.

## License

The original turn.js license is retained in `LICENSE.md`.
