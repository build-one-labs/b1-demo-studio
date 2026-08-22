---
name: b1-create-demo-video
description: Author and produce a Build.One product video with the demo factory (src/app-server-ts/demo-factory) — write demos/<id>/demo.yaml as a storyboard, verify every selector against the running app, then validate → prepare → record → render. Use when the user says "create a demo video", "record a demo", "make a product video", "storyboard a demo", "demo factory", "add a scene", "re-record a scene", "regenerate the demo", or mentions demo.yaml.
---

# Create a demo video

One YAML file is one video. `demos/<demo-id>/demo.yaml` holds the storyboard —
scenes, voice-over, cue markers, browser actions, assertions, branding — and the
pipeline turns it into an MP4, an SRT and a reproducible run manifest:

```text
demo.yaml -> voice-over + cue timestamps -> Playwright scenes
          -> Remotion composition -> MP4 + SRT + run-manifest.json
```

Everything below runs from `src/app-server-ts`. The pipeline lives in its
`demo-factory/` folder (beside `src/`), its dependencies are the app server's
own, and `yarn demo:*` scripts in the app server's `package.json` wrap the CLI
(`node demo-factory/src/cli.mjs`). The root `yarn install` installs everything.

The same four stages are buttons on the **Demo Factory Studio** screen (app
`b1-demo-factory`, `DemoFactoryScreen`). The screen and this skill drive
identical code — the CLI is what you use when authoring, the screen is what a
human uses to re-run a stage.

---

## Phase 1: Decide the story before writing YAML

A scene earns its place by making **one statement** and showing **one visible
proof** of it. From `AUTHORING.md`:

- 15 to 45 seconds
- one statement, one visible piece of evidence
- at most three meaningful interactions
- unambiguous start and end state
- **no dependence on what another scene left behind** — every scene records in a
  fresh browser context

Three to five scenes is a product video. More than that is a training course,
and it will not survive the next UI change.

## Phase 2: Verify the screen exists, and that it has data

This is the step that is skipped and then costs a re-record. Two checks, both
before a line of YAML:

1. **The screen is in this blueprint.** `list_objects` / `get_object` on the
   B1_Blueprint MCP. A demo vendored from another repository routinely names a
   screen that does not exist here — `sales-tour-planning` targets
   `SalesTourPlanningScreen`, which lives in vanguard's Samples module and not
   in this one, so it validates and renders but can never record.
2. **Its data source actually returns rows.** `query_data_source` on the DSO
   behind the view you intend to film. An empty result is a filmed chart with a
   0.0–1.0 axis and no bars, and it is the reason `opportunities-map` films two
   views and not the three that exist.

Also check what the screen *renders* for the fields you narrate. The Amount
column on `OpportunitiesMapScreen` is anonymized to `***********` by the
restricted-events handler and then formatted as `$NaN` — true of the app, fatal
in a video. Narrate around it or fix it, but do not film it.

## Phase 3: Write the storyboard

Create `demos/<demo-id>/demo.yaml`. The id is lowercase, digits and hyphens
(`^[a-z0-9][a-z0-9-]*$`), and it must equal the directory name.

`src/schema.mjs` is the contract — read it rather than guessing. The shape:

```yaml
schemaVersion: 1                 # literal 1
id: my-demo                      # == directory name
title: A sentence, not a label   # this is the video's opening title
description: One paragraph on what the video argues.

settings:
  language: en
  viewport: {width: 1920, height: 1080}
  fps: 30
  baseUrl:
    env: B1_BASE_URL             # the env var that overrides the fallback
    fallback: http://localhost:8080/?app=sample-app
  authStateEnv: B1_AUTH_STATE
  headlessEnv: DEMO_HEADLESS
  holdBeforeMs: 700              # stillness before the first action
  holdAfterMs: 1400              # stillness after the last one
  cursor: {enabled: true, moveDurationMs: 700, clickLeadMs: 120, clickEffectDurationMs: 560, sizePx: 30}
  narration:
    provider: auto               # auto | elevenlabs | silent
    voiceIdEnv: ELEVENLABS_VOICE_ID
    apiKeyEnv: ELEVENLABS_API_KEY
    modelIdEnv: ELEVENLABS_MODEL_ID
    defaultModelId: eleven_multilingual_v2
    languageCodeEnv: ELEVENLABS_LANGUAGE_CODE
    defaultLanguageCode: en
    wordsPerMinute: 132          # only used to estimate timing when silent
  branding:
    productName: Build.One
    accentColor: "#1266f1"
    backgroundColor: "#0b1020"
    textColor: "#f7f8ff"
    showCaptions: true
    showSceneTitles: true

scenes:
  - id: live-pipeline            # ^[a-z0-9][a-z0-9-]*$
    title: The pipeline, straight from Salesforce
    route: /screens/OpportunitiesMapScreen   # must start with /
    narration: >
      Spoken text. [cue:show-list] Markers are not spoken — they are timestamps.
    actions: []
    assertions: []
```

The quickest correct start is to copy `demos/opportunities-map/demo.yaml` and
replace the scenes: its `settings` block is the one verified against this
workspace.

### Cue markers are the timing model

`[cue:name]` inside narration marks a moment in the voice-over. ElevenLabs
returns character-level timestamps, so an action bound to `atCue: name` fires
exactly when the voice reaches that word. Without an ElevenLabs key the timing
is estimated from text length and `wordsPerMinute` — same file, silent video.

Every `atCue` **must** name a marker present in that scene's own narration;
validate fails otherwise. Markers are stripped before speech synthesis.

### Actions

`goto`, `click`, `dblclick`, `fill`, `type`, `press`, `hover`, `highlight`,
`waitFor`, `screenshot`. Bind each to a cue (`atCue`) or an absolute time
(`atMs`), optionally nudged by `offsetMs` (which only applies together with
`atCue`/`atMs`). `type` is `fill` made visible — it types character by
character (`delayMs` per keystroke, default 35), for prompts the viewer should
watch being written. A `waitFor` can carry `stableMs`: the target must stay
visible that long, continuously, before the wait counts as met — for states
that flicker, like an agent status chip reading "Ready" between working steps.

**Timelapse** — for live, unpredictably long waits (an agent building an app,
an analysis running): a `waitFor` with `timelapse: true` records the wait in
real time, and the render compresses exactly that stretch to the narration's
own budget — the gap from the wait's cue to the next cue-bound action — with a
fast-forward badge on screen. `timelapse: {targetMs: 8000}` overrides the
budget. A wait that resolves inside its budget plays back uncompressed.

**Setup** — a demo-level `setup:` block (route + actions) runs before any scene
records, in a browser context that is never filmed: repository resets, seed
data, dismissed first-run dialogs. No narration, so actions run strictly in
order. Skipped on `--scenes=` partial re-records.

```yaml
    actions:
      - action: waitFor
        atCue: show-list
        target: {demoId: opportunity-table}
        timeoutMs: 30000
      - action: highlight
        atCue: read-row
        target: {css: '.p-datatable-tbody > tr:nth-child(2)'}
        durationMs: 3200
```

Target selectors, in order of preference:

1. `demoId:` — a `data-demo-id` attribute. Layout and CSS may change; these
   stay. This is the contract the app is supposed to honour.
2. `role:` + `name:`
3. `label:` or `text:`
4. `css:` — last resort, and the first thing to break

The synthetic cursor moves to the target on its own for `click`, `fill`,
`press`, `hover` and `highlight`, starting *before* the cue so the action still
lands on it. Never put screen coordinates in a demo.

### Assertions

Every scene should prove it filmed something. Two forms:

```yaml
    assertions:
      - visible: {css: '.leaflet-marker-icon >> nth=0'}
      - textContains: {target: {css: '.p-datatable'}, value: 'Negotiation/Review'}
```

**Verify every selector against the running app before recording** — open the
screen, confirm the element exists and is what you think it is. A selector
invented from reading Vue source is the single most common cause of a scene
that records a blank page.

## Phase 4: Validate

```bash
cd src/app-server-ts
yarn demo:validate <demo-id>
```

Schema, cue references, ids and actions. Costs nothing; run it after every edit.

## Phase 5: Prepare the voice-over

```bash
yarn demo:prepare <demo-id> [--voice=elevenlabs|silent]
```

Creates a **new run** under `output/<demo-id>/<run-id>/`, synthesizes or
estimates the narration, derives cue and caption timestamps, and writes
`run-manifest.json`. Narration is content-addressed in `.cache/narration/`, so
unchanged text never calls ElevenLabs twice.

Without `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID` this still succeeds: the
video comes out silent and captioned, with timing estimated from text length.
That is a legitimate deliverable, not a failure.

## Phase 6: Record

```bash
yarn demo:record <demo-id> [--scenes=scene-a,scene-b]
```

Records into the **latest** run — so `prepare` first, always. Each scene gets a
fresh browser context and is bound to its cue timestamps.

Three things it needs, and the first two are how it fails:

- **`B1_BASE_URL` must carry the app query.** It overrides the demo's own
  fallback, so `http://localhost:8080` alone records the *default* app and your
  screen never appears. Use `http://localhost:8080/?app=sample-app`.
- **A signed-in session.** `B1_AUTH_STATE` (a Playwright storage state) wins
  where one exists; otherwise `record.mjs` sends `B1_USER_API_KEY` as a context
  header, which authenticates navigation and XHR alike. With neither, the run
  stops rather than film the sign-in page. `yarn demo:auth:workspace` mints a
  state from the API key where the auth server supports the handoff;
  `demo-factory/tools/auth-from-session.mjs` takes a `b1.session_token` cookie from a browser
  you are already signed into.
- **A browser.** Playwright's managed Chromium, or a system one named by
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

`--scenes` re-records part of a run, but only one whose previous recording
**completed** — an aborted run has no manifest to reuse.

## Phase 7: Render

```bash
REMOTION_OFFTHREADVIDEO_CACHE_MB=512 REMOTION_CONCURRENCY=2 yarn demo:render <demo-id>
```

Composes clips, voice-over, titles, callouts and captions. On a 16 GB workspace
an uncapped render dies partway with `Compositor exited with signal SIGTERM`, so
keep the cache cap unless you know the host is bigger.

Output lands in `output/<demo-id>/<run-id>/`:

- `<demo-id>.mp4`
- `<demo-id>.srt`
- `run-manifest.json` — the reproducible record of the run

`yarn demo:publish:web <demo-id>` copies a finished run into the web app's
public folder. `yarn demo <demo-id>` is all of it in one process
(validate → auth → prepare → record → render).

Paths in `output/`, `.cache/` and `demos/` are relative to
`src/app-server-ts/demo-factory`.

## When the host cannot record or render

Recording needs a browser and rendering needs ffmpeg and ffprobe. In a
workspace, `.devcontainer/scripts/provision-demo-factory.sh` installs both into
the app server's container on every start (`yarn demo:provision` by hand); the
app server's image ships both. The Studio screen asks the server what it can do and disables the
stages it cannot run, with the reason attached.

If you are on a host without them, **stop at Phase 5 and say so**. A validated,
prepared demo is a complete deliverable: it means the storyboard is correct, the
narration is cached, and a human can press Record and Render in the Studio. Do
not fake a video, and do not report a demo as produced when only its YAML exists.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `Invalid demo id` | id has uppercase or underscores | `^[a-z0-9][a-z0-9-]*$`, matching the directory |
| validate fails on a cue | `atCue` names a marker not in that scene's narration | markers are per scene, not per demo |
| Records the wrong app | `B1_BASE_URL` without `?app=` | `http://localhost:8080/?app=sample-app` |
| Records the sign-in page | no storage state and no API key | set `B1_USER_API_KEY`, or mint `B1_AUTH_STATE` |
| Scene is blank | selector never matched | verify it in the running app; prefer `data-demo-id` |
| Scene works alone, fails in sequence | it depends on another scene's UI state | every scene starts in a fresh context |
| `Compositor exited with signal SIGTERM` | uncapped render on a small host | `REMOTION_OFFTHREADVIDEO_CACHE_MB=512 REMOTION_CONCURRENCY=2` |
| `record` finds no run | `prepare` not run, or the last run aborted | re-run `prepare` |

## Reference

| What | Where |
|---|---|
| Schema (the contract) | `src/app-server-ts/demo-factory/src/schema.mjs` |
| Scene rules, actions, cursor | `src/app-server-ts/demo-factory/AUTHORING.md` |
| Step-by-step walkthrough | `src/app-server-ts/demo-factory/TUTORIAL.md` |
| Pipeline and timing model | `src/app-server-ts/demo-factory/ARCHITECTURE.md` |
| Workspace setup, auth, recording notes | `src/app-server-ts/demo-factory/README.md` |
| Worked example (recorded) | `src/app-server-ts/demo-factory/demos/opportunities-map/demo.yaml` |
| Live-recorded example (timelapse, setup, two apps) | `src/app-server-ts/demo-factory/demos/b1-vibecode-governance/demo.yaml` |
| Authoring reference (not recordable here) | `src/app-server-ts/demo-factory/demos/sales-tour-planning/demo.yaml` |
| Studio screen and its server actions | `src/web-app/src/components/global/DemoFactoryStudio.vue`, `src/app-server-ts/src/server-actions/demo-factory/` |

