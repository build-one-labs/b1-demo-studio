# B1 Demo Factory

Demo-as-code pipeline for reproducible Build.One product videos, extracted from
`build-one-labs/vanguard` (PR #1890), which had in turn vendored it from
[`build-one-labs/b1-demo-factory`](https://github.com/build-one-labs/b1-demo-factory).
One YAML per demo drives the whole run:

```text
demo.yaml -> voice-over + cue timestamps -> Playwright scenes
          -> Remotion composition -> MP4 + SRT + run manifest
```

Part of the app server: this folder sits beside `src/app-server-ts/src`, its
dependencies are in the app server's `package.json` (installed by the root
`yarn install`), and the `demo-factory` server actions spawn it as a child
process. Nest's tsc and ESLint leave it alone — it is ESM `.mjs`, plus a
React/Remotion composition (`src/remotion`) that Remotion bundles itself at
render time; `tsconfig.json` and `eslint.config.mjs` here cover those.

## Quick start

```bash
cd src/app-server-ts
yarn demo <demo-id>                 # validate -> auth -> prepare -> record -> render
yarn demo:publish:web <demo-id>     # copy the run into the web app's public folder
```

Stage by stage: `yarn demo:validate|demo:prepare|demo:record|demo:render
<demo-id>` (each wraps `node demo-factory/src/cli.mjs`).

In a Codespace the browser and ffmpeg the container needs are already in place —
see *A workspace provisions itself* below — and the Studio screen records
without any of it. `yarn demo:provision` re-runs that setup after a stack
restart.

The final video lands in `output/opportunities-map/<run-id>/opportunities-map.mp4`,
next to the SRT captions and the reproducible `run-manifest.json`.

`ffmpeg`/`ffprobe` must be on the PATH (`sudo apt-get install -y ffmpeg` in a
workspace) — they normalize the Playwright WebM clips before the frame-exact
Remotion cut.

## The b1-demo-factory app

The blueprint app `b1-demo-factory` starts on `DemoFactoryScreen`, whose only
content is the `b1_native_component` `DemoFactoryNativeComponent` →
`DemoFactoryStudio` (`src/web-app/src/components/global/DemoFactoryStudio.vue`).

That component is the Demo Factory's original standalone Studio ported onto a
B1 screen: storyboard, scene inspector with cue
markers, Voice-over and Actions tabs, the four pipeline stages, a timeline, the
pipeline log, and a preview that streams whichever run you pick. Three
deliberate differences from upstream:

- **No second web server.** Every call goes to the `demo-factory` server actions
  in `src/app-server-ts`, so the dashboard is part of the application rather
  than a second process somebody has to remember to start.
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
letting a stage fail deep inside a spawned process. That covers four things: the
pipeline's dependencies (the app server's own, so present wherever `yarn
install` ran), a browser, an ffmpeg, and a workspace API key. `Run full demo`
needs all four, because
`tools/run-demo.mjs` is every stage plus the auth mint; `start-job` refuses the
same way, so the API is not a way around the check.

**A workspace provisions itself.** The dev stack's app-server container is a
stock slim node image with the repository bind-mounted: no chromium, no ffmpeg,
and the generated compose file passes it `AUTH_URL` and no workspace API key.
So a Codespace could not record at all, and `tools/provision-workspace.mjs`
closes that gap — it is the Dockerfile block below, applied to a running dev
stack:

- Playwright's bundled ffmpeg into `.cache/ms-playwright` (`recordVideo` will
  not start without Playwright's own, and will not take the system one
  instead). It lands in the repository, so it outlives the container.
- `apt-get install chromium ffmpeg` inside the app-server container. This is
  the one step the container's own lifetime bounds — the image is not ours and
  the compose file that picks it is generated — so it re-runs after a stack
  restart.
- `.env.app-server`, holding what the app server needs and a shell must not
  have: the container's binary paths, and `B1_BASE_URL=http://caddy:8080/`,
  which is how the container reaches the web app (`localhost:8080` there is the
  app server itself). The Studio reads it as defaults beneath the Settings tab.

A demo also needs the screen it films to have data, and
`.devcontainer/scripts/app-server-secrets.mjs` is the other half of the same
gap: a Codespace secret is set on the devcontainer, not on the compose services
beside it, so `opportunities-map` recorded a table reading "Salesforce
credentials are not configured" while the shell three feet away had them. It
forwards an allowlist of connector credentials into `src/app-server-ts/.env`,
which the app server's `ConfigModule` already loads. Topology variables are
deliberately not forwarded — the workspace's `AUTH_URL` and database URLs name
hosts as seen from outside the compose network, and the container's own are the
correct ones.

`.devcontainer/scripts/provision-demo-factory.sh` runs the provisioner once the
stack is up — as a `postAttachCommand`, and again from the catch-up prebuild for
a Codespace whose prebuild image predates that hook — so a fresh Codespace
records without being asked. After restarting the stack by hand, `yarn
demo:provision` puts the container's half back. It is idempotent, and it never
fails a startup: a workspace that records nothing should not break over a
browser it will not use.

`src/app-server-ts/Dockerfile` installs `chromium` and `ffmpeg` and copies this
folder in beside `dist`, so all four stages work from a deployed app.
One Chromium serves all three users: Playwright's managed download does not
support musl, and Remotion otherwise fetches its own Chrome Headless Shell at
render time — which needs network from inside a running container. Both are
pointed at the distribution's binary through
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and `REMOTION_BROWSER_EXECUTABLE`, the
same way `FFMPEG_PATH` has always worked in `media.mjs`. Leave those unset and
each tool resolves its own browser exactly as before.

That block is not free — Chromium and ffmpeg add a few hundred megabytes to a
slim node image. Delete it if the deployed app
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
  does not work against the default remote auth server. `yarn demo` runs it
  automatically; upstream's interactive `tools/capture-auth.mjs` is kept for
  recording against a foreign environment.

  The mint is best-effort, not a gate. It needs an auth server carrying the
  `x-api-key` handoff branch, and an older deployment answers 401 — which used
  to end the run at its second step even though `record.mjs` has a second way
  in, authenticating every request in the take with the API key header. So a
  refused mint is now reported and the run continues, on the stored state where
  one exists and on the header otherwise. It stops only when there is neither,
  because the alternative is a recording of the sign-in page.
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

- **`b1-vibecode-governance`** — the ten-minute product video (vibe coding +
  governance), recorded **live** against `vanguard-develop.test.build.one`:
  an agent really builds the app on every take, with `timelapse:` waits
  compressing the build in the render and a `setup:` repository reset before
  each take. Needs a session-cookie auth state and an ElevenLabs key — the
  header comment in its `demo.yaml` is the run book.
- **`opportunities-map`** — recorded locally. Two scenes on
  `OpportunitiesMapScreen` (mini-apps): the live Salesforce list, and the same
  connector source plotted on a map. 69 seconds, silent and captioned.
- **`sales-tour-planning`** — the vendored original, kept as an authoring
  reference. It targets `/screens/SalesTourPlanningScreen`, which exists in
  vanguard's Samples module but **not in this blueprint**, so it validates and
  renders but cannot record here.

Every `yarn demo*` script takes the demo id as its argument.

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
REMOTION_OFFTHREADVIDEO_CACHE_MB=512 REMOTION_CONCURRENCY=2 yarn demo:render <demo-id>
```

**The bundle must not restart the server that spawned it.** Remotion writes its
webpack cache to the `node_modules/.cache/webpack/` above the pipeline's cwd —
`src/app-server-ts/node_modules/`. `tsconfig.json` excludes that from the
*program*, which is not the same as excluding it from the *watcher*: under
`nest start --watch` those writes read as "File change detected", and the Nest
CLI tree-kills the server together with the render it spawned. The symptom is a
run whose log stops dead on `Selecting composition B1Demo…` seconds after
`Bundling the Remotion composition — done`, with no exit line, while the
container itself never restarted (`docker inspect` shows `RestartCount=0`).
`watchOptions.excludeDirectories` in `src/app-server-ts/tsconfig.json` is what
keeps the watcher off both `node_modules` trees; if a render starts dying there
again, check that it survived a tsconfig edit.

**Salesforce credentials reach the app server through a `.env`, not compose.**
`SALESFORCE_INSTANCE_URL`, `SALESFORCE_CLIENT_ID` and `SALESFORCE_CLIENT_SECRET`
must be set for the connector. Setting them as workspace secrets is not enough:
those land on the *devcontainer*, while the connector runs in the `app_server_ts`
compose service, which passes an explicit environment allowlist and does not
name them. Editing `.deploy/workspace.docker-compose.yml` does not stick either —
it is generated and gitignored, so regenerating drops the entries again.

`.devcontainer/scripts/app-server-secrets.mjs` is the durable path: it copies an
allowlist of workspace secrets into `src/app-server-ts/.env`, which
`ConfigModule.forRoot()` loads, and restarts the app server. It runs from
`provision-demo-factory.sh` on every Codespace start, and by hand after adding a
secret:

```bash
node .devcontainer/scripts/app-server-secrets.mjs
```

When a connector starts reading a new secret, add it to that script's
`FORWARDED` allowlist. Symptom when this is missing: the screen's table is empty,
the app server logs `Salesforce credentials are not configured`, and a demo whose
first scene waits for a table row dies on a 30s `waitFor` timeout.

Without `ELEVENLABS_API_KEY`/`ELEVENLABS_VOICE_ID` the pipeline still runs — it
produces a silent, captioned video with cue timing estimated from text length.

## Logs

Every stage narrates itself on stdout with a wall-clock stamp — scene by scene
while recording, clip by clip while normalising, and every ten percent of the
Remotion render — so a run that stops can be placed at the step it stopped in.

Where that lands depends on who started it:

- **From a shell** (`yarn demo:record …`) it is the terminal. Keep a copy with
  `yarn demo:render <demo-id> 2>&1 | tee /tmp/render.log`.
- **From the Studio screen** the app server pipes it into the log panel *and*
  writes it to `output/logs/<started-at>--<demo>--<stage>.log` (the panel shows
  the path; the newest 50 files are kept). The panel's tail lives in the server
  process, so a `nest --watch` restart mid-run empties it — the file is what
  survives, and it is on the same volume the workspace sees:

  ```bash
  tail -f src/app-server-ts/demo-factory/output/logs/*.log
  ```

A run's own directory is the other half of the picture: `run-manifest.json`
after prepare and record, `normalized/` and `<demo-id>.mp4` plus
`render-result.json` after render. A run dir with `normalized/` but no
`render-result.json` stopped during the Remotion bundle or render. Two causes
account for most of those, and the log tells them apart: `Compositor exited with
signal SIGTERM` partway through the frames is the frame cache, while a log that
ends on `Selecting composition B1Demo…` with no error at all is the watcher
restart — both are above.

## Authoring

See `TUTORIAL.md` (the full walkthrough from empty project to finished MP4),
`AUTHORING.md` (scene rules, actions, cue markers, timelapse, setup block,
synthetic cursor) and `ARCHITECTURE.md` (pipeline stages, timing model). The
short version: narration text carries `[cue:name]` markers; ElevenLabs returns
character-level timestamps, so every browser action bound to a cue fires
exactly when the voice reaches that word. Selectors prefer `data-demo-id`,
then `role`+`name`, with CSS as the last resort. For live, unpredictably long
stretches (an agent building, an analysis running) a `waitFor` with
`timelapse: true` records in real time and renders compressed; a demo-level
`setup:` block resets the environment before each full take without being
filmed.

Two recording constraints worth knowing before editing `demo.yaml`:

- Every scene records in a **fresh browser context** — no scene may depend on
  UI state another scene left behind.
- Re-record single scenes with
  `yarn demo:record <demo> --scenes=<id>` — but only from a run whose
  previous recording **completed**; an aborted run has no manifest to reuse.
  Narration is content-addressed under `.cache/narration/`, so unchanged text
  never calls ElevenLabs twice.

Upstream extras not vendored (fetch from the source repo if needed): the local
B1 fixture, the `payment-infrastructure` and `vibecode-sales-tour` reference
demos, the source-video import tools, and the standalone Studio UI that edits
demo YAMLs in a browser (superseded here by the `DemoFactoryStudio` screen).
