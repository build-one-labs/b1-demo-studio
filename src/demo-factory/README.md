# B1 Demo Factory

Demo-as-code pipeline for reproducible Build.One product videos, extracted from
`build-one-labs/vanguard` (PR #1890), which had in turn vendored it from
[`build-one-labs/b1-demo-factory`](https://github.com/build-one-labs/b1-demo-factory).
One YAML per demo drives the whole run:

```text
demo.yaml -> voice-over + cue timestamps -> Playwright scenes
          -> Remotion composition -> MP4 + SRT + run manifest
```

Not part of the yarn workspaces on purpose — it is an npm project with its own
lockfile (React/Remotion must not hoist into the Vue monorepo tree).

## Quick start

```bash
cd src/demo-factory
npm ci
npx playwright install --with-deps chromium   # no-op when already cached
npm run demo                                  # validate -> auth -> prepare -> record -> render
npm run publish:web                           # copy the run into the web app's public folder
```

The final video lands in `output/opportunities-map/<run-id>/opportunities-map.mp4`,
next to the SRT captions and the reproducible `run-manifest.json`.

`ffmpeg`/`ffprobe` must be on the PATH (`sudo apt-get install -y ffmpeg` in a
workspace) — they normalize the Playwright WebM clips before the frame-exact
Remotion cut.

## The b1-demo-factory app

The blueprint app `b1-demo-factory` starts on `DemoFactoryScreen`, whose only
content is the `b1_native_component` `DemoFactoryNativeComponent` →
`DemoFactoryStudio` (`src/web-app/src/components/global/DemoFactoryStudio.vue`).

That component is the upstream Studio (`studio/public`, vendored here for
reference) ported onto a B1 screen: storyboard, scene inspector with cue
markers, Voice-over and Actions tabs, the four pipeline stages, a timeline, the
pipeline log, and a preview that streams whichever run you pick. Three
deliberate differences from upstream:

- **No second web server.** Every call goes to the `demo-factory` server actions
  in `src/app-server-ts`, so the dashboard is part of the application rather
  than a `npm run studio` process somebody has to remember to start.
- **Polling, not SSE.** A B1 action is request/response, so the screen polls
  `job-status` while a stage runs. Same object, one fewer transport.
- **The CLI owns validation.** `save-demo` writes the YAML, runs
  `cli.mjs validate`, and restores the previous file if it fails — so the zod
  schema in `src/schema.mjs` stays the only copy rather than being
  reimplemented in TypeScript.

Run media (the MP4 and SRT of a run) is the one piece that cannot be an action:
a `<video>` issues its own ranged GET and expects a 206 back, so
`demo-factory/media/:demoId/:runId/:file` is a small streaming controller
alongside them.

**The host decides which stages work.** The screen asks the server what it can
do (`capabilities`) and disables the rest with the reason attached, rather than
letting a stage fail deep inside a spawned process.

`src/app-server-ts/Dockerfile` installs `chromium` and `ffmpeg` and ships the
factory with its own `npm ci`, so all four stages work from a deployed app.
One Chromium serves all three users: Playwright's managed download does not
support musl, and Remotion otherwise fetches its own Chrome Headless Shell at
render time — which needs network from inside a running container. Both are
pointed at the distribution's binary through
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and `REMOTION_BROWSER_EXECUTABLE`, the
same way `FFMPEG_PATH` has always worked in `media.mjs`. Leave those unset and
each tool resolves its own browser exactly as before.

That block is not free — Chromium, ffmpeg and the factory's dependencies add
several hundred megabytes to a slim node image. Delete it if the deployed app
never records, and the Studio will say so on screen.

**Run artefacts are portable between mount points.** prepare and record write
absolute paths into `latest-run.json` and `run-manifest.json`, rooted wherever
the repository happened to be. The same run is now reached under two names — a
workspace shell sees `/workspaces/<repo>`, the app server container sees
`/workspace` — so `loadLatestRun` rebuilds `runDir` from the output root and
`rehomeManifest` rewrites the scene paths against the current project root. The
run id identifies a run; the prefix in front of it does not.

## What differs from upstream

- **Target**: `B1_BASE_URL` defaults to `http://localhost:8080/` — the
  workspace's web app — instead of upstream's local fixture server (the fixture
  is upstream's contract test and is not vendored).
- **Auth**: `tools/b1-auth-state.mjs` mints the Playwright storage state from
  the workspace API key via the auth server's handoff flow (the same exchange
  `b1 inspect` and the E2E suite use), because the system-user password login
  does not work against the default remote auth server. `npm run demo` runs it
  automatically; upstream's interactive `tools/capture-auth.mjs` is kept for
  recording against a foreign environment.
- **Player host**: `src/remotion/composition.ts` is new here — it lifts the
  composition id, dimensions, default props and duration formula out of
  `Root.tsx` so the B1 native component can share them. `Root.tsx` is otherwise
  unchanged in behaviour.
- **`publish:web`**: `tools/publish-web.mjs` is new here — it is the copy step
  between a rendered run and the web app's public folder.
- **`app-ready` marker**: upstream writes `data-demo-id="app-ready"` into the
  framework's `main` layout. Here the framework is a published package, so the
  app stamps the marker on instead, from
  `src/web-app/src/plugins/demo-ready.client.ts`. It marks only `.b1-shell-row`,
  never a fallback element, so the marker stays absent on `/sign-in` exactly as
  upstream's does — verified in a real browser.
- **Auth helper resolution**: `tools/b1-auth-state.mjs` imported the handoff
  helper from vanguard's `src/cli/`, which does not exist in a product repo. It
  now tries that path first and falls back to the identical file shipped inside
  `@buildone/swat-cli`.

## Demos

- **`opportunities-map`** — the default, and recorded. Two scenes on
  `OpportunitiesMapScreen` (mini-apps): the live Salesforce list, and the same
  connector source plotted on a map. 69 seconds, silent and captioned.
- **`sales-tour-planning`** — the vendored original, kept as an authoring
  reference. It targets `/screens/SalesTourPlanningScreen`, which exists in
  vanguard's Samples module but **not in this blueprint**, so it validates and
  renders but cannot record here.

Run a non-default demo with the CLI directly:
`node src/cli.mjs validate|prepare|record|render <demo-id>`.

### Why two scenes and not three

The screen has a third view — the "Recent Revenue" tab — and it is deliberately
not filmed: `ProductRevenueDSO` returns `[]` here, because local product revenue
shares no account with the Salesforce org, so the chart renders an empty 0.0–1.0
axis. The narration also stays off the **Amount** column, which the
restricted-events handler anonymizes to `***********`; the currency formatter
then renders that as `$NaN`. Both are worth fixing, neither is worth filming.

## Recording notes

**Authentication.** Neither documented login works in this workspace: the API-key
handoff (`auth:workspace`) needs an auth server implementing the `x-api-key`
branch of `/api/auth/mcp/handoff/issue`, and this one answers `401 {"message":
"Missing session"}` to a valid key, a bogus key and no key alike; the
interactive capture (`auth:b1`) launches a HEADED browser, and a codespace has
no `DISPLAY`.

What works instead: the app server's guard accepts `x-api-key` on any request
and resolves it to the owning user, and Playwright applies context headers to
navigation and XHR alike. `record.mjs` therefore sends `B1_USER_API_KEY` as a
context header when it is set and no storage state exists — the whole recorded
session is authenticated, with nothing to mint and nothing to paste. A
`B1_AUTH_STATE` storage state still wins where one exists.
`tools/auth-from-session.mjs` remains as a third way in: hand it the
`b1.session_token` cookie from a browser you are already signed into.

**`B1_BASE_URL` must carry the app query.** It overrides the demo's own
fallback, so `http://localhost:8080` alone records the *default* app and the
screen never appears. Use `http://localhost:8080/?app=sample-app`.

**Rendering needs a capped frame cache.** On a 16 GB workspace an uncapped
render dies partway with `Compositor exited with signal SIGTERM`:

```bash
REMOTION_OFFTHREADVIDEO_CACHE_MB=512 REMOTION_CONCURRENCY=2 npm run demo:render
```

**Salesforce credentials reach the app server through compose.**
`SALESFORCE_INSTANCE_URL`, `SALESFORCE_CLIENT_ID` and `SALESFORCE_CLIENT_SECRET`
must be set for the connector, but the `app_server_ts` service passes an
explicit environment allowlist, so workspace secrets alone never arrive. They
were added to `.deploy/workspace.docker-compose.yml`, which is **generated and
gitignored** — regenerating the deploy files drops them again. The durable fix
belongs in whatever produces that file.

Without `ELEVENLABS_API_KEY`/`ELEVENLABS_VOICE_ID` the pipeline still runs — it
produces a silent, captioned video with cue timing estimated from text length.

## Authoring

See `AUTHORING.md` (scene rules, actions, cue markers, synthetic cursor) and
`ARCHITECTURE.md` (pipeline stages, timing model). The short version: narration
text carries `[cue:name]` markers; ElevenLabs returns character-level
timestamps, so every browser action bound to a cue fires exactly when the voice
reaches that word. Selectors prefer `data-demo-id`, then `role`+`name`, with
CSS as the last resort.

Two recording constraints worth knowing before editing `demo.yaml`:

- Every scene records in a **fresh browser context** — no scene may depend on
  UI state another scene left behind.
- Re-record single scenes with
  `node src/cli.mjs record <demo> --scenes=<id>` — but only from a run whose
  previous recording **completed**; an aborted run has no manifest to reuse.
  Narration is content-addressed under `.cache/narration/`, so unchanged text
  never calls ElevenLabs twice.

Upstream extras not vendored (fetch from the source repo if needed): the local
B1 fixture, the `payment-infrastructure` and `vibecode-sales-tour` reference
demos, the source-video import tools, and the Studio UI (`npm run studio`
upstream) that edits demo YAMLs in a browser.
