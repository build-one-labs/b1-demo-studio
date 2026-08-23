# Hand-over: Demo Factory in a deployed stack — state & how to continue

For the next agent (or human) building on this. As of Aug 22, 2026, branch
`feature/demo-factory-deployed` (stacked on `feature/vibecode-governance-demo`,
PR #8). The overall plan with architecture and phases:
https://claude.ai/code/artifact/8feb05e4-560c-48ef-b67a-fd1da94ff4dc

## What is done (this branch)

| Piece | Where | State |
|---|---|---|
| `DEMO_CACHE_DIR` (configurable narration cache) | `src/lib/files.mjs` (`resolveCacheRoot`), `narration.mjs`, `demo-factory.lib/host.ts` | ✅ tested |
| Narration cache in Postgres (`demo_narration_cache`, bytea audio) | `demo-factory.narration-cache.ts`, migration `drizzle/0014_*` | ✅ restore before prepare/all, ingest after; best-effort, never blocks a job |
| Run manifests in Postgres (`demo_run_manifests`) | `demo-factory.run-ingest.ts` (`persistManifest`) | ✅ upsert on every reconcile |
| Export/import/save as a document | `demo-factory.transfer.ts` + actions `export-demo` / `import-demo` / `save-demo` | ✅ jest spec `demo-factory.transfer.spec.ts`; writes ALWAYS go through the materializer hooks (validation) |
| Download endpoints | `demo-factory.media.controller.ts` (`…/download/:file`, subdirectory route for `narration/…` — incidentally fixes the 404ing narration URLs) | ✅ |
| Auth without a shell (`mint-auth-state`) | action in `demo-factory.actions.ts`, UI in the Settings tab | ✅ writes the storage state under `<outputRoot>/auth/`, sets `B1_AUTH_STATE` |
| Operator guard | `assertOperator` in `demo-factory.lib.ts`, env `DEMO_FACTORY_OPERATORS` | ✅ unset = open; interim until Melange |
| Studio UI | `DemoFactoryStudio.vue`: ⤓ export, ⤒ import dialog, MP4/SRT downloads, session-token mint, 🗨 agent dialog | ✅ lint green |
| Agent → environment mode | `DemoCreatorAgent.json` (`agentEnvironment: ""`), prompt clob `27043fb7…`, skill clob `43fb802c…` (both rewritten MCP-oriented) | ✅ content; **E2E untested** (see below) |
| Studio → agent conversation | `startAgentConversation()` via `agent-proxy/create-conversation` with `agentObjectMasterGuid` `34e589aa-…` | ✅ code; **E2E untested** |
| Deployment layer | `.build/deploy/standalone.deployment.config.json`: volume `demo_factory_data` → `/data/demo-factory`, `DEMO_OUTPUT_DIR`/`DEMO_CACHE_DIR`, ELEVENLABS/OPERATORS env | ✅ (careful: `.deploy/` is generated and gitignored — the source is `.build/deploy/`) |
| `setup:` block round-trip fix | `rows.ts`, `transfer.ts`, `DemoFactoryStudio.vue` | ✅ the rows spec had caught that `setup` was lost in the document↔rows split |
| Remote rendering | `tools/remote-render.mjs` + `latest-run` action (`yarn demo:render:remote`) | ✅ pulls demo + run inputs via media routes, renders locally with the same code path; README documents the `gh codespace ports forward` recipe |
| Voice consistency & pronunciation | `narration.mjs` (`applyPronunciations`, configurable `voiceSettings` in the cache key), schema | ✅ demo uses stability 0.78 / style 0 and speaks "Build.One" as "Build One"; if a cloned voice still drifts on long scenes, the next lever is chunked synthesis with ElevenLabs request stitching (`previous_request_ids`) |

Tests: `yarn test` in `src/app-server-ts` (24 jest + 19 node), build and both
lints green. Migration 0014 is applied against the workspace database.

## What is open — concrete next steps

1. **`execute_action` (platform — built in the vanguard repository, not here).**
   Mike's decision: a generic MCP tool `execute_action` plus discovery
   `list_actions`. The complete, hand-over-ready requirement specification
   (tool contracts mirroring the `invokeServerTask` semantics, identity,
   two-stage authorization, error passthrough, acceptance criteria, open
   implementation questions) is its own document for the platform team:
   https://claude.ai/code/artifact/8f497cb5-1a85-41a0-a348-46757821c8ac
   Until the tool exists, the agent can only reach the actions through its
   environment's terminal; the skill clob already says so.
   → Hand the specification to the platform team; this repo is the first
   consumer.
2. **Agent E2E test.** `agentEnvironment: ""` + `create-conversation` with
   `environmentUrl` matches the documentation, but was never run against a real
   environment. Verify: (a) the conversation lands in environment mode,
   (b) `/screens/agentChatScreen` exists in this blueprint (the Studio's
   navigation assumes it), (c) what auth the agent's terminal carries for
   action POSTs. The code names its fallbacks (`conversationId` field name).
3. **Melange instead of the operator allowlist.** `DEMO_FACTORY_OPERATORS` is
   an interim. Target: an `.fga` model + `@MelangeCheck` on the mutating
   actions (the `b1-melange-authorization` skill describes the path). Then
   remove the allowlist or keep it as an extra filter — decide deliberately.
4. **Blueprint import into existing environments.** The changed clobs
   (prompt/skill) and the agent object live in `src/data`. An *existing*
   environment does not re-import `src/data` (`IMPORT_DATA=false` in the
   workspace) — bring the objects in via `b1` import or the Blueprint MCP.
5. **Full migration of the demo/scene/run DSOs to Postgres** (plan phase 4).
   Deliberately NOT started: the clob DSOs already persist, and the validation
   hangs on their server-event hooks. Whoever takes this on: clarify hooks for
   entity DSOs, use `schema-to-blueprint`, and note that `store.ts` is the
   single access layer (one swap point).
6. **S3 as an artifact-storage option** (plan phase 4): the volume stays the
   default; presigned downloads would be the next step. Needs an
   infrastructure decision.
7. **The `.deploy` workspace copy**: my volume/env change was additionally
   written into the local (generated) `.deploy/standalone.*` — the next
   `npx b1 deploy` generation takes it from `.build/deploy/` anyway; nothing to
   do, just don't be surprised.

## Traps that would otherwise cost you hours

- **Writing past the hooks wedges the factory.** NEVER commit demo/scene rows
  directly (not via `write_clob` through the Blueprint MCP either): only the
  app server's commit path fires the materializer validation.
  `save-demo`/`DemoFactoryTransfer.saveDocument` is the only write path;
  internal seed writes mark themselves with `INTERNAL_WRITE` (CLS).
- **Commit order in `saveDocument`**: demo row → scene creates/updates →
  scene deletes. Every intermediate state must be valid for the per-record
  hooks; the spec `demo-factory.transfer.spec.ts` pins this.
- **`.deploy/` is generated and gitignored** — the tracked source is
  `.build/deploy/`. An edit in `.deploy/` disappears with the next generation.
- **A workspace container restart loses chromium/ffmpeg** →
  `yarn demo:provision`. The Studio's capability check shows it.
- **`yarn demo` (the all-in-one) re-mints the auth state** and can overwrite a
  cookie-built state for a foreign host — for demos against other
  environments, run the stages individually (also stated in the header of
  `demos/b1-vibecode-governance/demo.yaml`).
- **Sandbox capacity** is the most common live-demo failure: delete hanging
  sandboxes before a take, do not use the environment in parallel while a take
  runs. `retry:` on the sandbox waits heals transient failures.
- **One app-server replica.** The job model is single-process; the start-up
  reconcile closes orphaned `running` jobs.

## Verifying after changes

```bash
cd src/app-server-ts
yarn test                 # jest + demo-factory node tests
yarn build && yarn lint
yarn demo:validate b1-vibecode-governance
cd ../web-app && yarn lint
```

For a real end-to-end proof: open the Studio (`?app=b1-demo-factory`),
export → import as a copy → delete the copy; download a run's MP4; mint a
session token and run `Run full demo` against the own environment.
