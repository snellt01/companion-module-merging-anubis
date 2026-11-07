import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const baseConfig = await generateEslintConfig({
	enableTypescript: true,
})

export default [
	...baseConfig,
	{
		// Tests use dev dependencies (vitest); they aren't part of the built module.
		files: ['src/**/__tests__/**/*'],
		rules: {
			'n/no-unpublished-import': 'off',
		},
	},
]
