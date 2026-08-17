<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
		children?: Snippet;
		page?: number;
	}

	let { children, page, class: className = '', style = '', ...rest }: Props = $props();

	const pageClass = $derived(['turn-page-content', className].filter(Boolean).join(' '));
</script>

<div class={pageClass} style={style} data-page={page} {...rest}>
	{@render children?.()}
</div>

<style>
	.turn-page-content {
		width: 100%;
		height: 100%;
		box-sizing: border-box;
		overflow: hidden;
	}
</style>
