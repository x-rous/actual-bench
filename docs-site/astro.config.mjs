// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Actual Bench documentation site.
// Published as a GitHub Pages project site, so it is served under a base path.
// https://astro.build/config
export default defineConfig({
	site: 'https://x-rous.github.io',
	base: process.env.DOCS_BASE ?? '/actual-bench',
	vite: {
		server: {
			// Dev-only: allow a reverse-proxy host (e.g. code-server) when set.
			// Unset in normal builds, so default behavior is unchanged.
			allowedHosts: process.env.DOCS_ALLOWED_HOST ? [process.env.DOCS_ALLOWED_HOST] : [],
		},
	},
	integrations: [
		starlight({
			title: 'Actual Bench',
			description:
				'End-user documentation for Actual Bench — the advanced admin, budgeting, diagnostics, and ActualQL workbench for Actual Budget.',
			logo: {
				src: './src/assets/actual-bench-logo.png',
				alt: 'Actual Bench',
				replacesTitle: true,
			},
			favicon: '/favicon.png',
			social: [
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/x-rous/actual-bench' },
			],
			editLink: {
				baseUrl: 'https://github.com/x-rous/actual-bench/edit/main/docs-site/',
			},
			// Lead with the jobs readers came to do. Detailed entity and operator
			// reference stays available without competing with the primary workflows.
			sidebar: [
				{
					label: 'Start Here',
					items: [
						{ label: 'What Actual Bench adds', link: '/getting-started/introduction/' },
						{ label: 'Install Actual Bench', link: '/getting-started/installation/' },
						{ label: 'Connect to a budget', link: '/getting-started/connecting/' },
						{ label: 'Work safely', link: '/getting-started/core-concepts/' },
					],
				},
				{
					label: 'Common Workflows',
					items: [
						{ label: 'Plan a full year', link: '/user-guide/budget-management/' },
						{ label: 'Set up & clean up data', link: '/user-guide/managing-your-data/' },
						{ label: 'Build & audit rules', link: '/user-guide/rules/' },
						{ label: 'Reconcile a bank statement', link: '/user-guide/bank-reconciliation/' },
						{ label: 'Sync budget files', link: '/user-guide/budget-sync/' },
						{ label: 'Explore & diagnose data', link: '/user-guide/budget-file-tools/' },
					],
				},
				{
					label: 'Feature Reference',
					collapsed: true,
					items: [
						{ label: 'Budget Overview', link: '/getting-started/budget-overview/' },
						{ label: 'Accounts', link: '/user-guide/accounts/' },
						{ label: 'Payees', link: '/user-guide/payees/' },
						{ label: 'Categories', link: '/user-guide/categories/' },
						{ label: 'Schedules', link: '/user-guide/schedules/' },
						{ label: 'Tags', link: '/user-guide/tags/' },
						{ label: 'Rule Diagnostics', link: '/user-guide/rule-diagnostics/' },
						{ label: 'ActualQL', link: '/user-guide/actualql/' },
						{ label: 'FX Rates', link: '/user-guide/fx-rates/' },
						{ label: 'Bundle Export / Import', link: '/user-guide/bundle-export-import/' },
					],
				},
				{
					label: 'For Self-hosters',
					collapsed: true,
					items: [
						{ label: 'Deployment', link: '/administration/deployment/' },
						{ label: 'Configuration', link: '/administration/configuration/' },
						{ label: 'Upgrades & backups', link: '/administration/upgrading-and-backups/' },
						{ label: 'App Health', link: '/administration/app-health/' },
					],
				},
				{
					label: 'Help',
					collapsed: true,
					items: [
						{ label: 'Troubleshooting', link: '/help/troubleshooting/' },
						{ label: 'Known limitations', link: '/help/known-limitations/' },
						{ label: 'Glossary', link: '/help/glossary/' },
						{ label: 'Contributing', link: '/contributing/' },
					],
				},
			],
		}),
	],
});
