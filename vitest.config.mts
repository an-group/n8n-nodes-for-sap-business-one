import { defineConfig } from 'vitest/config';

export default defineConfig({
	// n8n-workflow ships sourcemaps without their sources, which makes Vite log a
	// "points to missing source files" warning per module on every run.
	logLevel: 'error',
	test: {
		include: ['test/**/*.test.ts'],
		environment: 'node',
		globals: false,
		clearMocks: true,
		restoreMocks: true,
		coverage: {
			provider: 'v8',
			reportsDirectory: 'coverage',
			// lcovonly, not lcov/html: the HTML report ships PNG assets, and
			// `n8n-node build` copies every **/*.{png,svg} outside dist/ and
			// node_modules/ into dist/ — so an html report would end up published.
			reporter: ['text-summary', 'lcovonly'],
			include: ['nodes/**/*.ts'],
		},
	},
});
