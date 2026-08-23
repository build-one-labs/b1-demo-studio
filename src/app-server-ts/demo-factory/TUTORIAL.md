# Tutorial: Creating a demo video with the B1 Demo Factory

This tutorial walks through the Demo Factory once, end to end: what it is, how
it works, and how to produce a finished product video step by step — from an
empty project to an MP4 with voice-over and captions.

Reference documents alongside:

| Document | Content |
|---|---|
| `README.md` | Setup, auth, provisioning, troubleshooting in detail |
| `AUTHORING.md` | Scene rules, all actions, cue markers, timelapse, setup block, cursor |
| `ARCHITECTURE.md` | Pipeline stages and the timing model |
| `src/schema.mjs` | The binding contract for `demo.yaml` (zod schema) |
| `demos/b1-vibecode-governance/demo.yaml` | Large live example (timelapse, setup, two apps) |
| `demos/opportunities-map/demo.yaml` | Small, verified example |

---

## 1. The concept: demo as code

A demo video is not recorded here — it is **described**. A single YAML file per
video — `demos/<demo-id>/demo.yaml` — holds everything:

- the **scenes** (which screen, which clicks, which highlights),
- the **voice-over** (the spoken text, sentence by sentence),
- the **cue markers** that bind browser actions to exact words in the
  voice-over,
- **assertions** that prove each scene really filmed what it claims,
- branding, resolution, language, voice.

From that, the pipeline produces the video deterministically:

```text
demo.yaml → voice-over + cue timestamps (ElevenLabs)
          → Playwright drives the scenes in a real browser
          → Remotion cuts clips, audio, titles and captions together
          → MP4 + SRT + run-manifest.json
```

The payoff: there are no slips of the tongue, every take is identical, and when
the UI or the text changes you edit one line of YAML and render again — instead
of re-recording sixteen minutes of narration.

### The four stages

1. **Validate** — checks the YAML against the schema: ids, cue references,
   actions.
2. **Prepare** — produces the voice-over. With an ElevenLabs key: real speech
   with character-precise timestamps; without one: a silent video with
   estimated timing and captions. Narration is cached by content hash —
   unchanged text never calls ElevenLabs twice.
3. **Record** — Playwright opens each scene in a **fresh browser context**,
   executes the actions exactly at their cue times, and records the viewport as
   WebM. A synthetic cursor visibly travels to every target.
4. **Render** — Remotion composes clips, audio, scene titles, captions and
   time-lapse segments into the final MP4.

Every stage can run individually; `record` can re-shoot single scenes with
`--scenes=` without touching the rest.

### The timing model (the heart of it)

The narration text carries markers that are never spoken:

```yaml
narration: >
  Here is the pipeline. [cue:show-list] These rows come live from
  Salesforce.
actions:
  - action: highlight
    atCue: show-list
    target: { css: '.p-datatable' }
```

ElevenLabs returns a timestamp for every character of the spoken text. From
that, the pipeline knows to the millisecond **when** the voice reaches the word
behind `[cue:show-list]` — and exactly then the action fires. The cursor starts
moving beforehand, so the click lands on the cue.

---

## 2. The two front ends

**CLI** (from `src/app-server-ts`):

```bash
yarn demo:validate <demo-id>     # check the schema
yarn demo:prepare  <demo-id>     # produce the voice-over (--voice=silent forces silent)
yarn demo:record   <demo-id>     # the browser recording (--scenes=a,b for a partial take)
yarn demo:render   <demo-id>     # the final MP4
yarn demo          <demo-id>     # all in one: validate → auth → prepare → record → render
yarn demo:publish:web <demo-id>  # copy a finished run into the web app's public folder
```

**Demo Factory Studio** — the `b1-demo-factory` app in the browser
(`http://localhost:8080/?app=b1-demo-factory`): storyboard editor, scene
inspector with voice-over and actions tabs, the four pipeline stages as
buttons, pipeline log and a video preview per run. Studio and CLI drive the
same code; the Studio additionally shows what the host can do (browser? ffmpeg?
API key?) and disables stages that cannot run — with the reason attached.

In the Studio, **＋** (next to the demo picker) creates a new project — as a
copy of the open demo, or from a blank starter template when nothing is
selected. The Settings tab takes runtime settings (`B1_BASE_URL`, ElevenLabs
keys, …); secrets stay in the server process and never land in the blueprint or
in git.

---

## 3. Prerequisites

### Tools (once per workspace)

In a Codespace, `provision-demo-factory.sh` sets everything up on start. After
a stack restart, run it once more:

```bash
cd src/app-server-ts && yarn demo:provision
```

That installs Chromium + ffmpeg into the app-server container, places
Playwright's ffmpeg in `.cache/ms-playwright`, and writes
`demo-factory/.env.app-server`.

### Voice-over: ElevenLabs

Two values, without which the video stays silent (but captioned):

- `ELEVENLABS_API_KEY` — the API key
- `ELEVENLABS_VOICE_ID` — the voice

Create them as **Codespace secrets** (repo → Settings → Codespaces); the script
`.devcontainer/scripts/app-server-secrets.mjs` forwards them into the
app-server container on start (run it once by hand after creating them).
Alternatively, enter them in the Studio's Settings tab — valid until the next
server restart. Optional: `ELEVENLABS_MODEL_ID` (default
`eleven_multilingual_v2`).

### Authenticating the recording

The recording browser must be signed in. Three ways, try them in this order:

1. **Session cookie** (always works, including against foreign deployments):
   in a signed-in browser, DevTools → Application → Cookies →
   `b1.session_token`, then:
   ```bash
   cd src/app-server-ts
   B1_BASE_URL=https://<target-host>/ node demo-factory/tools/auth-from-session.mjs <token>
   export B1_AUTH_STATE=demo-factory/playwright/.auth/b1-demo-user.json
   ```
2. **API-key header**: with `B1_USER_API_KEY` set, `record` sends it as
   `x-api-key` on every request. Only works when the target app server accepts
   header auth.
3. **Handoff mint** (`yarn demo:auth:workspace`): needs an auth server with the
   `x-api-key` handoff — older deployments answer 401.

Quick check of what actually arrives: `node demo-factory/tools/probe-auth.mjs
<url>` reports whether the browser sees the app shell or the sign-in page.

### The target URL

`B1_BASE_URL` **must carry the app query** — `http://localhost:8080` alone
films the default app. Correct: `http://localhost:8080/?app=sample-app`. A demo
can also declare its own variable name in `settings.baseUrl.env` (e.g.
`B1_VIBECODE_BASE_URL`) so the workspace default cannot override it.

---

## 4. Step by step to the video

### Step 1 — Decide the story

Before the first line of YAML: what is the statement, and what is the visible
proof? A good scene (from `AUTHORING.md`):

- 15–45 seconds (live scenes with timelapse may run longer)
- one statement, one visible piece of evidence
- at most three meaningful interactions
- an unambiguous start and end state
- **no dependence on another scene's UI state** — every scene starts in a
  fresh browser context

Three to five scenes make a product video. A ten-minute video like
`b1-vibecode-governance` gets by with eight.

### Step 2 — Verify that screens and data exist

The most-skipped step, and the most expensive one: **open every screen in the
running target system** before you describe it. Does the data source return
rows? Does the field you narrate render real values (or `$NaN`, `***********`,
an empty axis)? Whatever renders empty or broken gets narrated around or fixed
first — never filmed.

### Step 3 — Create the project

In the Studio: **＋** → assign an id (`lowercase-with-dashes`) and a title. Or
by hand: create `demos/<id>/demo.yaml` — fastest as a copy of an example; the
`settings` block of `opportunities-map` is verified against this workspace. The
id must equal the directory name.

### Step 4 — Write the scenes

Per scene: `id`, `title` (shown as an interstitial title card), `route` (starts
with `/`, may carry `?app=…`), `narration` with cue markers, `actions`,
`assertions`.

**Actions**: `goto`, `click`, `dblclick`, `fill`, `type` (types visibly,
`delayMs` per character), `press`, `hover`, `highlight`, `waitFor` (optionally
with `timelapse` and/or `stableMs` — the target must stay visible that long
without interruption, against flickering states like a status chip that briefly
reads "Ready" between agent steps), `screenshot`. Every action binds to
`atCue` (or `atMs`), optionally shifted by `offsetMs` — `offsetMs` only takes
effect together with `atCue`/`atMs`.

**Selectors**, in this order:

1. `demoId:` — a `data-demo-id` attribute. The stable contract with the app.
2. `role:` + `name:` — e.g. `{ role: button, name: Create private draft }`
3. `label:` / `text:`
4. `css:` — the last resort, and the first thing to break

**Verify every selector against the running app before recording.** A selector
guessed from reading source code is the most common cause of a scene that films
a blank page.

**Assertions** at the end of the scene — the proof that what was claimed got
filmed:

```yaml
assertions:
  - visible: { css: '.leaflet-marker-icon >> nth=0' }
  - textContains: { target: { css: '.p-datatable' }, value: 'Negotiation' }
```

### Step 5 — Live sections with timelapse

When real, unpredictably long work happens in the video (an agent builds an
app, an analysis runs), record it live and let the render compress it:

```yaml
narration: >
  The agent gets going. [cue:working] It analyzes data sources and building
  blocks and assembles the app. [cue:done] Finished — here is the result.
actions:
  - action: waitFor
    atCue: working
    target: { text: 'Ready' }
    timeoutMs: 900000
    timelapse: true
  - action: highlight
    atCue: done
    target: { css: '.preview' }
```

The recording really waits (up to `timeoutMs`); the render compresses exactly
that stretch to the narration budget between `working` and `done` — with a
▶▶ badge on screen. Details in `AUTHORING.md`.

### Step 6 — Automate the starting state (setup block)

When a take mutates the system (live demos!), a `setup` block re-establishes
the known starting state before every full take — unfilmed:

```yaml
setup:
  route: /screens/changesSearch?app=b1
  actions:
    - action: click
      target: { text: 'Reset Repository' }
    - action: waitFor
      target: { css: '.p-toast-message' }
      timeoutMs: 180000
```

### Step 7 — Validate and check the voice-over

```bash
yarn demo:validate <id>                 # after every edit, costs nothing
yarn demo:prepare <id> --voice=silent   # prints each scene's length in seconds
```

The prepare output is your length budget: add up the scene lengths, add the
holds (~2.5 s per scene) — that is the video length. Trimming text here is one
YAML line; after recording it is a re-shoot.

### Step 8 — Record

```bash
yarn demo <id>          # all in one, OR:
yarn demo:prepare <id>  # real voice-over (cache hits for unchanged text)
yarn demo:record <id>   # the take
```

`record` writes into the **latest** run — so `prepare` first, always. If a
scene fails, a screenshot of the failing moment sits next to the clips
(`clips/<scene>.failure.png`). Re-shooting individual scenes:

```bash
yarn demo:record <id> --scenes=scene-a,scene-b
```

— but only on top of a run whose recording **completed**, and knowing that the
`setup` block is skipped on partial takes.

### Step 9 — Render and publish

```bash
yarn demo:render <id>
```

(On small workspaces, `REMOTION_OFFTHREADVIDEO_CACHE_MB=512` and
`REMOTION_CONCURRENCY=1|2` are already the provisioning defaults; without the
cap, a 1080p render dies with `Compositor exited with signal SIGTERM`.)

The result lands in `output/<id>/<run-id>/`: `<id>.mp4`, `<id>.srt`,
`run-manifest.json`. `yarn demo:publish:web <id>` copies the run into the web
app; it appears in the Studio's preview.

---

## 5. Without a Codespace: the Demo Factory in a deployed stack

A deployed stack of this repository is a complete video workbench — no git, no
shell. The differences from workspace operation:

- **Demos live in data sources** (persistent in the blueprint database); the
  YAML file is only the pipeline's working copy. Runs and the narration cache
  live on the `demo_factory_data` volume; the cache and the run manifests are
  additionally mirrored into Postgres (`demo_narration_cache`,
  `demo_run_manifests`) — a redeploy does not re-buy any voice-over.
- **Export/import**: ⤓ exports the open demo as `demo.yaml` (the backup and
  transfer format; comments survive as long as rows and file agree);
  ⤒ imports YAML by paste — validated like any Studio edit, with collision
  handling (refuse / overwrite / import as copy).
- **Download**: MP4/SRT buttons next to the preview and in the runs table
  (`…/media/<demo>/<run>/download/<file>`).
- **Auth without a shell**: paste the `b1.session_token` cookie of a signed-in
  browser session into the Settings tab → "Mint auth state" writes the
  Playwright auth state server-side and sets `B1_AUTH_STATE`.
- **Access control**: `DEMO_FACTORY_OPERATORS` (a comma-separated list of
  e-mails) in the stack environment restricts all mutating actions to the
  listed accounts; unset = open (the workspace behaviour).
- **The Demo Creator straight from the Studio**: the 🗨 button starts a
  conversation with the agent against this environment — it reads through
  `query_data_source`, writes exclusively through `save-demo`, and drives the
  pipeline through `start-job`/`job-status`.

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Invalid demo id` | uppercase/underscores | `^[a-z0-9][a-z0-9-]*$`, equal to the directory |
| Validate complains about a cue | `atCue` without a marker in the scene | markers are per scene, not per demo |
| Wrong app filmed | `B1_BASE_URL` without `?app=` | append the app query |
| Sign-in page filmed | no auth | session cookie / `B1_USER_API_KEY` (section 3) |
| Scene is blank | selector never matched | verify in the running system; prefer `data-demo-id` |
| Scene works alone, fails in sequence | depends on another scene | every scene starts fresh |
| Render dies (`SIGTERM`) | frame cache without a cap | `REMOTION_OFFTHREADVIDEO_CACHE_MB=512`, `REMOTION_CONCURRENCY=2` |
| Render stalls after `Selecting composition` | `nest --watch` killed the render | check `watchOptions.excludeDirectories` in `tsconfig.json` |
| `record` finds no run | `prepare` missing, or the last run aborted | run `prepare` again |
| Dead air in the video | a real wait recorded uncompressed | `timelapse: true` on the `waitFor` |

Logs: from a shell, stdout is the log; from the Studio it lands in the log
panel **and** in `output/logs/<time>--<demo>--<stage>.log` (survives server
restarts, `tail -f` works).

---

## 7. The demo projects in this repo

- **`b1-vibecode-governance`** — the ten-minute product video (vibe coding +
  governance), recorded live against `vanguard-develop.test.build.one`. Uses
  everything in this tutorial: `type`, timelapse, the setup reset, app
  switching by scene cut and by `goto`.
- **`opportunities-map`** — small, verified locally, a good starting point to
  copy.
- **`sales-tour-planning`** — an authoring reference (its target screen does
  not exist in this blueprint; it validates and renders but does not record
  here).
