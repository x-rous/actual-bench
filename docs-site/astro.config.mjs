// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Actual Bench documentation site.
// Published as a GitHub Pages project site, so it is served under a base path.
// https://astro.build/config
// Served under a base path, and the redirect targets below have to carry it:
// Astro applies the base to the routes it generates, but the destination is
// written out verbatim.
const base = process.env.DOCS_BASE ?? '/actual-bench';

export default defineConfig({
	site: 'https://x-rous.github.io',
	base,
	vite: {
		server: {
			// Dev-only: allow a reverse-proxy host (e.g. code-server) when set.
			// Unset in normal builds, so default behavior is unchanged.
			allowedHosts: process.env.DOCS_ALLOWED_HOST ? [process.env.DOCS_ALLOWED_HOST] : [],
		},
	},
	// Every page this restructure moved keeps its old address working: these
	// URLs are in released notes, issues and other people's bookmarks.
	redirects: {
		'/user-guide/managing-your-data': `${base}/getting-started/editing-and-saving/`,
		'/user-guide/budget-file-tools': `${base}/user-guide/budget-file-health/`,
		'/user-guide/bundle-export-import': `${base}/getting-started/bundle-export-import/`,
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
			// The sidebar mirrors the app's own left navigation — same groups, same
			// order, same names. A reader looking at "Payee Cleanup" in the app
			// should find "Payee Cleanup" here, not a workflow title invented for
			// the documentation. Task-shaped entry points ("plan a full year",
			// "reconcile a statement") live on the home page, where someone with a
			// job in mind starts, rather than as a second scheme competing with
			// this one.
			sidebar: [
				{
					label: 'Start Here',
					items: [
						{ label: 'What Actual Bench adds', link: '/getting-started/introduction/' },
						{ label: 'Install Actual Bench', link: '/getting-started/installation/' },
						{ label: 'Connect to a budget', link: '/getting-started/connecting/' },
						{ label: 'Work safely', link: '/getting-started/core-concepts/' },
						{ label: 'Editing, review and save', link: '/getting-started/editing-and-saving/' },
						{ label: 'Overview', link: '/getting-started/budget-overview/' },
						{ label: 'Bundle Export / Import', link: '/getting-started/bundle-export-import/' },
					],
				},
				{
					// The app's Data Management group, in its order.
					label: 'Data Management',
					items: [
						{ label: 'Budget', link: '/user-guide/budget-management/' },
						{ label: 'Rules', link: '/user-guide/rules/' },
						{ label: 'Accounts', link: '/user-guide/accounts/' },
						{ label: 'Payees', link: '/user-guide/payees/' },
						{ label: 'Categories', link: '/user-guide/categories/' },
						{ label: 'Schedules', link: '/user-guide/schedules/' },
						{ label: 'Tags', link: '/user-guide/tags/' },
					],
				},
				{
					// The app's Tools group, in its order — including the two
					// adjacencies the app's own sidebar carries: FX Rates directly
					// under Budget File Sync, because it exists to serve
					// cross-currency syncing and nobody comes to it on its own, and
					// Bank Sync directly under Automations, because that is the engine
					// it runs on. Neither is indented; the app does not indent them,
					// and a headline feature should not read as a footnote to one.
					label: 'Tools',
					items: [
						{ label: 'Rule Diagnostics', link: '/user-guide/rule-diagnostics/' },
						{ label: 'Payee Cleanup', link: '/user-guide/payee-cleanup/' },
						{ label: 'Bank Reconciliation', link: '/user-guide/bank-reconciliation/' },
						{ label: 'Budget File Sync', link: '/user-guide/budget-sync/' },
						{ label: 'FX Rates', link: '/user-guide/fx-rates/' },
						{ label: 'Backups', link: '/user-guide/backups/' },
						{ label: 'Automations', link: '/user-guide/automations/' },
						{ label: 'Bank Sync', link: '/user-guide/bank-sync/' },
						{ label: 'ActualQL Queries', link: '/user-guide/actualql/' },
						{ label: 'Data Browser', link: '/user-guide/data-browser/' },
						{ label: 'Budget File Health', link: '/user-guide/budget-file-health/' },
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
