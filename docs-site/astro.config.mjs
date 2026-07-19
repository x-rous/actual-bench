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
			// Sidebar groups use autogenerate so an entry appears only once its page
			// exists — no empty or "coming soon" links while the site is built out.
			sidebar: [
				{ label: 'Getting Started', items: [{ autogenerate: { directory: 'getting-started' } }] },
				{ label: 'User Guide', items: [{ autogenerate: { directory: 'user-guide' } }] },
				{ label: 'Administration', items: [{ autogenerate: { directory: 'administration' } }] },
				{ label: 'Help', items: [{ autogenerate: { directory: 'help' } }] },
				{ label: 'Contributing', link: '/contributing/' },
			],
		}),
	],
});
