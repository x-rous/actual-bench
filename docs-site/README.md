# Actual Bench documentation site

The public end-user documentation for Actual Bench, built with [Astro Starlight](https://starlight.astro.build)
and published to GitHub Pages at **https://x-rous.github.io/actual-bench/**.

This is a **standalone project**. It has its own dependencies and build and is intentionally
decoupled from the main Actual Bench application — it does not share the app's `package.json`,
build, or runtime. Do not add Astro/Starlight dependencies to the root `package.json`, and do not
import application code here.

> **Node:** requires Node.js `>=22.12` (matches the app's recommended `22.23.1`).

## Local development

Run from **this `docs-site/` directory**:

```bash
npm install     # install dependencies
npm run dev      # start the dev server at http://localhost:4321/actual-bench
npm run build    # build the production site to ./dist/
npm run preview  # serve the production build locally
```

Or from the repository root, without changing directory:

```bash
npm --prefix docs-site install
npm --prefix docs-site run dev
npm --prefix docs-site run build
npm --prefix docs-site run preview
```

The site is served under the `/actual-bench` base path in every environment, so always open
`/actual-bench/` locally rather than `/`.

## Project structure

```
docs-site/
├── public/                     # static assets served as-is (favicon)
├── src/
│   ├── assets/                 # images processed by Astro (logo, screenshots)
│   │   └── screenshots/
│   └── content/
│       ├── docs/               # one .mdx page per documentation page
│       │   ├── index.mdx       # homepage (splash)
│       │   ├── getting-started/
│       │   ├── user-guide/
│       │   ├── administration/
│       │   └── help/
│       └── ...
├── astro.config.mjs            # site, base path, branding, sidebar
└── package.json
```

Each `.mdx` file is one substantial page; smaller workflows are sections (headings) within a page,
not separate pages. New pages appear in the sidebar automatically (groups use `autogenerate`).

## Authoring guidelines

- Write for end users, not maintainers. Use exact in-app labels and current behavior as the source
  of truth (see the docs brief in `agents/pr-specs/`).
- Keep internal links base-safe: use relative links between pages, or prefix with `/actual-bench/`.
- Put images in `src/assets/screenshots/<area>/` and reference them relatively; never reference the
  application's `public/` directory at runtime.
- Never include real secrets, credentials, private hostnames, or personal budget data.

## Deployment

Pushing documentation changes to `main` triggers `.github/workflows/docs.yml`, which builds the site
and deploys it to GitHub Pages. Pull requests get a build check only (no deploy). The workflow can
also be run manually via **workflow_dispatch**.

> **One-time repository setting:** enable Pages under
> **Settings → Pages → Build and deployment → Source: GitHub Actions**.
