# B1 Starter (Build.One)

A starter monorepo for building blueprint‑driven, evergreen enterprise frontends with the B1 Framework:

- Frontend: Nuxt 3 + Vue 3 + PrimeVue
- Backend: NestJS + Drizzle ORM + PostgreSQL
- Shared: B1 blueprints, Evergreen UI runtime, and CLI/tooling

This repo is the “starter‑style project” described in the B1 Framework documentation and is optimized for GitHub Codespaces and AI‑assisted development.

## What’s in this Starter

- **Frontend (`src/web-app/`)**
  - Nuxt 3 + Vue 3 application
  - Uses `@buildone/web-core`, `@buildone/web-framework`, and `@buildone/web-framework-layer`
  - PrimeVue, theming, and Evergreen UI runtime integration

- **Backend (`src/app-server-ts/`)**
  - NestJS application with Drizzle ORM and PostgreSQL
  - Hosts application APIs, server actions, and integration logic
  - Uses `@buildone/app-server-tslib` and Drizzle migrations

- **Blueprints & Data (`src/data/`)**
  - B1 blueprints, menus, and repository configuration (JSON/XML)
  - Imported into PostgreSQL and used by the Evergreen UI runtime

- **Tooling**
  - Yarn 4 workspaces
  - ESLint, Prettier, Jest
  - B1 Framework packages: `@buildone/app-server-tslib`, `@buildone/web-core`, `@buildone/web-framework`, `@buildone/web-framework-layer`
  - `@buildone/swat-cli` and related tooling

## Getting Started (Codespaces)

The recommended way to work with this starter is via GitHub Codespaces, as described in the B1 “Getting Started” and “Try It in Codespaces” guides:

1. Open this repository in **GitHub Codespaces**.
2. Let the dev container setup run (it installs dependencies and configures the stack).
3. Follow the B1 Introduction guide to start the app, run migrations, and explore the sample application.

For any non‑Codespaces or advanced usage, rely on the official B1 documentation rather than this README.

## AI & Claude Code

This starter is intended to be used together with Claude Code in GitHub Codespaces:

- Use Claude Code as your primary coding assistant for working with blueprints, UI, and backend logic.
- Follow the B1 “Introduction” guide for suggested prompts and safe, blueprint‑driven edits.
- See `CLAUDE.md` in this repo for concrete setup steps and usage tips specific to this starter.

## Framework Documentation in Codespaces

In GitHub Codespaces, you can open the B1 Framework documentation from the dev container:

- Use the B1 CLI command `b1 documentation` in the Codespaces terminal, or
- Use the preconfigured “Documentation” entry in the Ports/tasks UI (where available).

For details, see the B1 CLI documentation and the “Try It in Codespaces” / Introduction guides.

## CI/CD

This starter includes CircleCI configuration and related scripts.  
For how CI/CD fits into the overall B1 workflow (builds, tests, deploy), see the B1 CLI and operations documentation.

## Support

If you’re unsure how to proceed or something doesn’t work as expected, ask your B1 team for guidance and links to the latest framework documentation.

## Where to Learn More

This README intentionally stays short and defers to the B1 Framework documentation as the ground truth:

- **Getting started & architecture**
  - Getting Started (introduction, Codespaces, starter overview)
  - Fundamentals: Architecture, Blueprints & Objects, Data & Logic Layer, Evergreen UI

- **Backend and database**
  - “Database” and “Data & Logic Layer” fundamentals
  - `schema-to-blueprint` CLI documentation for generating blueprints from Drizzle schema

- **Security & auth**
  - “Security & Authentication (BetterAuth)” fundamentals

- **CLI & operations**
  - “CLI (build-one / b1)” documentation for stack management, preview, documentation, and DB admin commands

For repo‑specific details (AI usage, Codespaces secrets, etc.), also see `CLAUDE.md` and the individual workspace READMEs under `src/`.
