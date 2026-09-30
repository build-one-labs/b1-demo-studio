# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## About This Repository

This repository is based on the Build.One Starter GitHub template. When working with this codebase:
- The original template provides a foundation, but expect customizations specific to this project
- Database schema, server actions, and frontend components may differ from the template baseline
- Check actual file contents rather than assuming template defaults
- Version numbers of Build.One packages may vary - check `package.json` files for current versions

## Repository Overview

This is a monorepo containing a NestJS backend API server and a Nuxt.js frontend web application, using Yarn workspaces for dependency management.

## Workspace Structure

This is a Yarn 4 workspace with the following workspaces:
- `src/app-server-ts` - NestJS backend API server
- `src/data` - Data definitions and configuration files
- `src/web-app` - Nuxt.js frontend application

## Development Commands

### Root-level commands (run from repository root)
```bash
# Linting across all workspaces
yarn lint:check          # Check for lint errors across all workspaces
yarn lint:fix            # Fix lint errors across all workspaces

# Dependency management
yarn audit:ws            # Run security audit on all workspaces
yarn ncu:ws              # Check for outdated dependencies across workspaces
yarn syncpack:check      # Check for version mismatches across workspaces
yarn syncpack:fix        # Fix version mismatches across workspaces
```

### Backend (app-server-ts)
```bash
# Navigate to backend workspace
cd src/app-server-ts

# Development
yarn start:dev           # Start NestJS dev server with watch mode (port 3000)
yarn start:debug         # Start with debugger attached
yarn start:prod          # Production server

# Building
yarn build               # Build the NestJS application

# Linting
yarn lint                # Check for lint errors (max-warnings=0)
yarn lint:fix            # Fix lint errors

# Testing
yarn test                # Run unit tests with Jest
yarn test:watch          # Run tests in watch mode
yarn test:cov            # Run tests with coverage report
yarn test:e2e            # Run end-to-end tests
yarn test:debug          # Run tests with debugger

# Database (Drizzle ORM)
yarn db:migrate:generate <migration_name> # Generate new migration with specified name
yarn db:migrate          # Run pending migrations
yarn database:seed       # Seed database with initial data
```

### Frontend (web-app)
```bash
# Navigate to frontend workspace
cd src/web-app

# Development
yarn dev                 # Start Nuxt dev server with prepare step

# Building
yarn build               # Build for production (includes nuxt prepare)
yarn generate            # Generate static site
yarn preview             # Preview production build

# Linting
yarn lint                # Check for lint errors (max-warnings=0)
yarn lint:fix            # Fix lint errors
```

## Architecture

### Backend (app-server-ts)

**Technology Stack:**
- Framework: NestJS
- ORM: Drizzle ORM with PostgreSQL
- API: REST with Swagger/OpenAPI documentation
- Authentication: Passport with Bearer token strategy
- Server runs on port 3000 (default)

**Module Structure:**
- `AppModule` (src/app.module.ts) - Root module orchestrating all other modules
- `ApiModule` - Wraps CoreApiModule from @buildone/app-server-tslib
- `ServerActionsModule` - Custom server actions/endpoints
- `EventsModule` - Global event handlers for business logic
- `DrizzleModule` - Database integration configured at root level

**Database Schema:** Located in `src/app-server-ts/src/drizzle/schema/`. The starter includes a sample schema with tables for clients, customers, invoices, items, offers, orders, payments, products, sales representatives, and taxes. These tables serve as examples and should be modified or replaced based on your project's specific needs. Define your database tables here and export them from `src/drizzle/schema/index.ts`.

**Server Actions Pattern:**
Server actions use Build.One decorators:
- `@B1Service({ basePath: 'path' })` - Define service base path
- `@B1Action({ description: '...' })` - Define action endpoints
- Actions are defined in `src/app-server-ts/src/server-actions/`
- Template includes a sample Weather service demonstrating the pattern

**Demo Factory:** The demo-as-code video pipeline (Playwright record → Remotion render) lives in `src/app-server-ts/demo-factory/` — ESM `.mjs` beside `src/`, excluded from Nest's tsc/ESLint, with its own `README.md`, `AUTHORING.md` and `ARCHITECTURE.md`. Its dependencies are the app server's; the `demo-factory` server actions spawn `demo-factory/src/cli.mjs`, and `yarn demo:*` scripts in `src/app-server-ts/package.json` run it from a shell. The Studio UI is the blueprint app `b1-demo-factory`: standard screens (search → maintenance for demos and runs, settings) under `src/data/repository/b1-demo-factory/`, their client logic under `src/web-app/clientlogic/b1-demo-factory/`, and three project-owned object types — `b1_log_view`, `b1_media_player`, `b1_demo_timeline` (plus the form field `b1_json_field`) — whose components live in `src/web-app/src/components/` and are registered by the plugins in `src/web-app/src/plugins/`. Blueprint objects are created through the B1_Blueprint MCP and exported with `export_objects`; the JSON files are their versioning. In a Codespace, `.devcontainer/scripts/provision-demo-factory.sh` installs chromium/ffmpeg into the app-server container and writes `demo-factory/.env.app-server` (`yarn demo:provision` by hand).

**Authentication:**
- Global `B1AuthGuard` is applied at the app level
- Uses Bearer token authentication
- Token can be accessed via `SECHUB_TOKEN` environment variable

**Configuration:**
- Uses NestJS ConfigModule (global)
- Database URL: `APP_DATABASE_URL` environment variable
- SSL enabled for database connections

### Frontend (web-app)

**Technology Stack:**
- Framework: Nuxt 3
- UI: PrimeVue with @primevue/forms and @primevue/nuxt-module
- State Management: Pinia
- Image Optimization: @nuxt/image
- Extends: @buildone/web-framework-layer (Build.One custom layer)

**Configuration:**
- Source directory: `src/`
- Telemetry disabled
- Application title configurable in `nuxt.config.ts`
- Check `nuxt.config.ts` for current configuration settings

### Data Definitions (src/data)

Data definitions extend Build.One's SWAT framework:
- `data-definitions.json` - Main entry point extending `swat/data/data-definitions.json`
- `base-data-definitions.json` - Base product/module definitions
- `menu-data-definitions.json` - Menu structure definitions
- `repository-objects-definitions.json` - Repository object definitions

These files define data structures for the Build.One SmartFramework integration.

## CI/CD

Uses GitHub Actions with workflows in `.github/workflows/`:
- `build.yml` - Build and lint on push to `develop`, pull requests, and manual trigger. Uses `dorny/paths-filter` for change detection on PRs (only builds affected workspaces).
- `publish.yml` - On tag push, builds Docker images and publishes to AWS ECR (`653306034207.dkr.ecr.eu-central-1.amazonaws.com/starter/`)
- `audit.yml` - Weekly (Monday 9:00 UTC) and manual: runs `yarn audit:ws` and `yarn ncu:ws`
- `tag.yml` - Manual: creates a version tag via `npx b1 tag`
- `deploy.yml` - Manual: generates deployment files and deploys to Portainer via `npx b1 deploy`

A composite action at `.github/actions/setup-node/action.yml` handles AWS CodeArtifact authentication, Node.js setup, dependency caching, and installation across all workflows.

Each workspace has its own `Dockerfile` for production image builds:
- `src/app-server-ts/Dockerfile`
- `src/web-app/Dockerfile`
- `src/data/Dockerfile`

### Required GitHub Secrets for CI/CD

- `B1_ACCESS_KEY_ID` / `B1_SECRET_ACCESS_KEY` - AWS credentials for CodeArtifact and ECR
- `DEFAULT_PORTAINER_URL` / `DEFAULT_PORTAINER_API_KEY` - Portainer defaults for deploy workflow

## Build.One Framework

This application uses Build.One proprietary packages:
- `@buildone/app-server-tslib` - Backend utilities, auth, database modules
- `@buildone/web-core` - Frontend core utilities
- `@buildone/web-framework` - Frontend framework components
- `@buildone/web-framework-layer` - Nuxt layer with framework integration
- `@buildone/swat-cli` - CLI tooling for development
- `@buildone/swat-vscode` - VS Code integration
Check `package.json` files for current version numbers.

### SWAT CLI Knowledge Base

The `@buildone/swat-cli` package includes comprehensive documentation at `node_modules/@buildone/swat-cli/knowledge/`:

**Reference documentation for:**
- **Architecture & DevOps**: `architecture_info/CLAUDE.md` - Full framework architecture, CLI commands, deployment, CircleCI, git workflow, testing
- **Blueprint DSL**: `blueprint_dsl/CLAUDE.md` - UI generation, screens, layouts, menus, rendering engine
- **Skills**: `skills/CLAUDE.md` - Multi-step workflows (Portainer deployment, schema generation)

**Note:** The knowledge base documents the full Build.One Vanguard framework. This Starter template uses a simplified subset of that architecture. For advanced framework features, deployment patterns, or Blueprint DSL work, consult the knowledge base.

## Database Migrations

Database uses Drizzle Kit for migrations:
1. Generate migration: `yarn db:migrate:generate <migration_name>` (run from `src/app-server-ts`)
2. Review generated migration in `src/app-server-ts/drizzle/` directory
3. Apply migration: `yarn db:migrate` (run from `src/app-server-ts`)

**Note:** The starter includes existing migrations with sample data. Review the `drizzle/` directory to understand the current schema before creating new migrations.

Migration config: `src/app-server-ts/src/drizzle/drizzle.config.ts`
- Dialect: PostgreSQL
- Schema: `src/app-server-ts/src/drizzle/schema/index.ts`
- Output: `./drizzle` directory (relative to app-server-ts)

## GitHub Codespaces Integration

This repository is optimized for GitHub Codespaces with the B1 Framework. The development environment requires several secrets to be configured in the repository's Codespaces settings.

### Required Secrets for Codespaces

**Database:**
- `APP_DATABASE_CREDENTIALS` - App database credentials (username:password)
- `B1_DATABASE_CREDENTIALS` - Build.One platform database credentials (username:password)

**Authentication:**
- `BETTER_AUTH_SECRET` - Better Auth secret key (min 32 characters)
- `BUILDONE_TOKEN` - Build.One platform API token
- `BUILDONE_USER` - Build.One platform username

**Automation Hub (n8n):**
- `B1_AUTOMATION_HUB_EMAIL` - n8n email
- `B1_AUTOMATION_HUB_PASSWORD` - n8n password
- `B1_AUTOMATION_HUB_USER` - n8n username

**Optional:**
- `BLUEPRINT_MCP_AUTH` - Blueprint MCP credentials (username:password)
- `CLAUDE_ORG_UUID` - Claude organization UUID
- `CONTEXT7_API_TOKEN` - Context7 API token
- `PORTAINER_API_TOKEN` - Portainer API token
- `PORTAINER_URL` - Portainer instance URL

## Environment Variables

Key runtime environment variables:
- `APP_DATABASE_URL` - PostgreSQL connection string (auto-generated from `APP_DATABASE_CREDENTIALS` in Codespaces)
- `B1_DATABASE_URL` - Build.One database URL (auto-generated from `B1_DATABASE_CREDENTIALS` in Codespaces)
- `SECHUB_TOKEN` - Authentication token for API requests

## Testing

Backend uses Jest with TypeScript:
- Test files: `*.spec.ts` in `src/app-server-ts/src/` directory
- Config: Inline in `src/app-server-ts/package.json`
- Coverage output: `src/app-server-ts/coverage/` directory
- Run tests from the `src/app-server-ts` workspace

For comprehensive testing strategies including E2E testing, visual regression, and test environments, see `node_modules/@buildone/swat-cli/knowledge/architecture_info/testing.md`.
