# b1-demo-studio

A Build.One application: a Nuxt front end, a NestJS server, and the blueprints
that drive both. It was generated from the Build.One starter and set up for you
— its database, its container registry and its workspaces are already its own.

## Start working on it

Open a codespace on this repository, from the Build.One control panel or from
the **Code** button above. It builds itself: dependencies, database and secrets
are all in place by the time it opens, so there is nothing to install and
nothing to configure.

To work locally instead, open the repository in VS Code and reopen it in the dev
container — the same environment, on your own machine.

## What is where

| Path | What it holds |
| --- | --- |
| `src/web-app/` | The Nuxt 3 front end (Vue 3, PrimeVue, the Build.One web framework). |
| `src/app-server-ts/` | The NestJS server: APIs, server actions, and the Drizzle schema and migrations. |
| `src/data/` | The blueprints — screens, menus and data definitions — that the UI is built from. |

Each is a Yarn workspace. `yarn dev` in `src/web-app`, `yarn start:dev` in
`src/app-server-ts`, and `yarn lint:check` at the root for everything.

## Shipping a change

1. **Release.** The control panel's Release & Deploy screen tags a version and
   builds the three images — or run the **Publish Branch** workflow yourself.
2. **Deploy.** Deploy that version to an environment from the same screen, which
   runs the **Deploy Release** workflow.

Both workflows are in `.github/workflows/`, and what they build and where they
push it is set in `.build/deploy/`.

## What was set up for you

- **This repository**, generated from the Build.One starter.
- **A PostgreSQL database** of its own — Neon project `steep-smoke-51683579`.
- **A container registry** for its images: `653306034207.dkr.ecr.eu-central-1.amazonaws.com/buildone-samples`.
- **Cloud workspaces**, with the credentials they need already in place.

Its keys are held for your organization rather than in this repository: the
workspace fetches what it needs when it starts. Nothing here needs a secret
committed to it.

## Getting help

The Build.One control panel is where this repository was created, and where its
releases, deployments and workspaces are managed from.
