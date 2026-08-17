# svelte-turn-page

Svelte component library for modern page flipping books.

The package exposes Svelte components only. It does not bundle vendored browser plugins, demo routes, or tests.

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

`TurnBookApi` methods:

`next`, `previous`, `page`, `pages`, `view`, `range`, `size`, `display`, `disable`, `stop`, `animating`, `hasPage`, `addPage`, `removePage`, and `destroy`.

## Scripts

```sh
npm run check
npm run package
npm run lint
```

`npm run lint` runs Svelte checks, packages the library, and validates the package exports with `publint`.

## License

The original turn.js license is retained in `license.txt`.
