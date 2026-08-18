import { defineConfig, type OutExtensionContext, type UserConfig } from 'tsdown';

const outExtensions = ({ format }: OutExtensionContext) => ({
	js: format === 'cjs' ? '.cjs' : '.js'
});

const sharedConfig = {
	clean: false,
	format: ['esm', 'cjs'],
	outDir: 'dist',
	platform: 'neutral',
	outExtensions,
	deps: {
		neverBundle: [/\.svelte$/, 'svelte', /^svelte\//]
	}
} satisfies UserConfig;

export default defineConfig([
	{
		...sharedConfig,
		entry: {
			index: 'src/lib/index.ts'
		},
		dts: true
	},
	{
		...sharedConfig,
		entry: {
			'turn-engine': 'src/lib/turn-engine.ts',
			types: 'src/lib/types.ts'
		},
		dts: true
	}
]);
