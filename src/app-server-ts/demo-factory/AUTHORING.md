# Demo authoring

## Good scenes

- 15 to 45 seconds long
- one statement and one visible piece of evidence
- at most three meaningful interactions
- an unambiguous start and end state
- no dependence on the state a previous scene left behind

## Supported actions

- `goto`
- `click`
- `dblclick` — a double click, e.g. to open a card that a single click only selects
- `fill`
- `type` — like `fill`, but character by character (`delayMs` per keystroke, default 35). For prompts the viewer should watch being written.
- `press`
- `hover`
- `highlight`
- `callout` — an editable text banner at the bottom of the recording; see below.
- `waitFor` — optionally with `timelapse` (see below), `stableMs` and/or
  `retry`. `stableMs`: the target must stay visible for that many milliseconds
  without interruption before the wait counts as met — for states that flicker
  (e.g. a status chip that briefly reads "Ready" between agent steps).
  `retry: { target, everyMs }`: a rescue click — while the actual target is
  missing, the retry target is clicked whenever it is visible (at most every
  `everyMs`, default 45 s) — for live environments that fail transiently and
  offer a Retry button.
- `screenshot`

Targets are preferably given as:

```yaml
target:
  demoId: object-type-service
```

Alternatively `role` plus `name`, `label`, `text` or CSS for legacy UIs. CSS is
the last resort only.

## Cue markers

```yaml
narration: >
  The golden path turns into a concrete graph.
  [cue:show-graph] Here we see the payment service.

actions:
  - action: click
    atCue: show-graph
    target:
      demoId: navigation-object-graph
```

Cue markers are not spoken. Every referenced cue id must appear in the same
scene's narration text.

## Voice: pronunciations and voice settings

Two knobs under `settings.narration`:

```yaml
narration:
  pronunciations:
    Build.One: Build One      # written form → spoken form
  voiceSettings:
    stability: 0.78           # 0..1 — higher = more consistent, less expressive
    similarityBoost: 0.85
    style: 0
    speakerBoost: true
```

`pronunciations` replaces written forms with spoken ones before cue parsing
and synthesis — the YAML keeps the brand spelling, the voice loses the
sentence break a dot would cause. `voiceSettings` are passed to ElevenLabs and
are part of the narration cache key; the defaults match the factory's previous
hard-coded values. For long scenes with a cloned voice, raise `stability` and
drop `style` — a drifting clone is heard as the voice "switching" mid-scene.

Long narration is synthesized as **stitched chunks** by default
(`chunkChars: 550`, `0` disables): the text is cut at sentence ends, every
chunk is conditioned on its neighbours' text and on the previous requests'
ids (ElevenLabs request stitching), and audio and alignment are merged with
ffprobe-measured chunk lengths — short anchored calls are what keeps a cloned
voice from drifting over a two-minute scene.

## Timelapse: wait live, play back compressed

A `waitFor` with `timelapse` records a real, unpredictably long wait (an agent
building an app, an analysis running) in real time — and the render plays back
exactly that stretch accelerated, with a ▶▶ badge on screen:

```yaml
narration: >
  The agent starts working. [cue:agent-works] It analyzes data sources and
  building blocks and assembles the app. [cue:agent-done] And here is the
  result.

actions:
  - action: waitFor
    atCue: agent-works
    target: { text: 'Done. Your app is ready.' }
    timeoutMs: 600000
    timelapse: true
  - action: highlight
    atCue: agent-done
    target: { demoId: preview-panel }
```

The compressed length is the narration's own budget: the distance from the
wait's cue to the next cue-bound action (`agent-works` → `agent-done`). That is
what makes the footage after the wait land back exactly on its cue. An explicit
`timelapse: { targetMs: 8000 }` overrides the budget; with no following action
it is six seconds. If the real wait takes less than the budget, nothing is
compressed.

The narration between the two cues keeps playing normally — it describes what
the time-lapse shows.

## Setup: establish state without filming it

An optional demo-level `setup` block runs before the first scene in its own,
never-recorded browser context — for repository resets, seed data, or
dismissing first-run dialogs:

```yaml
setup:
  route: /screens/changesSearch?app=b1
  actions:
    - action: click
      target: { text: 'Reset Repository' }
    - action: waitFor
      target: { text: 'Repository reset' }
      timeoutMs: 120000
```

Without narration there are no cues: actions run in order, each as soon as the
previous one finished. `--scenes=` partial re-records skip `setup` — whoever
re-records a single scene wants to keep the state the other scenes left behind.

## Synthetic cursor

The cursor moves to the target element automatically for `click`, `dblclick`,
`fill`, `type`, `press`, `hover` and `highlight`. The movement starts before
the cue, so the action itself still fires exactly on the cue. Clicks get a
visible ripple.

Global settings live in `settings.cursor`:

```yaml
cursor:
  enabled: true
  moveDurationMs: 700
  clickLeadMs: 120
  clickEffectDurationMs: 560
  sizePx: 30
```

Because the target position is computed from the `data-demo-id` element, no
screen coordinates are needed in the demo definition.

## UI automation contract

B1 should provide stable ids for demo-relevant interactions:

```html
<button data-demo-id="navigation-object-types">Object Types</button>
<section data-demo-id="object-graph">...</section>
```

Layout and CSS may change as long as these semantic ids remain.

## Editable text banners

Use a `callout` action to show a lower-third banner in the browser recording.
It needs no target. `value` is plain text, and cues work like other actions:

```yaml
- action: callout
  atCue: permissions
  value: Your account. Your permissions.
```

The banner stays until another callout replaces it, the page navigates, or the
scene ends. Set `durationMs` to hide it automatically without blocking later
actions. An empty `value: ""` clears it. Edit the action in the Studio's scene
Actions JSON, then re-record and render to apply the change.

## Video demos: from the author's own screen recording

Instead of describing clicks as actions, an author can record the B1 app
themselves — any screen recorder, talking while they click — and upload the
file in the Studio (**Demos → Import video**). The result is an ordinary demo
whose scenes are ranges of that recording:

```yaml
source:
  video: 20261121144316-rh1uqk/source.mp4   # <upload-id>/<file> under <output>/uploads/
  durationMs: 61600
  width: 1600
  height: 900
  language: de
scenes:
  - id: scene-01
    title: Die Demo-Liste
    narration: Hier sehen wir das Demo Studio von Build One. …
    clip:
      startMs: 0          # range of the source video
      endMs: 23950
      voiceAtMs: 10360    # where the author started speaking, from startMs
```

A clip scene has no `route`, no actions and no assertions (validation says
so), and its `narration` may be empty — a stretch shown without voice-over. A
demo may mix clip scenes and filmed scenes; only the filmed ones start a
browser.

**Analysis** (`cli.mjs analyze <demo-id> --upload=<id> [--title=…]
[--language=de]`, the Studio's `import-video` action): ffprobe measures the
file, ffmpeg's scene filter (5 fps, 480 px) finds where the screen changes,
ElevenLabs Speech-to-Text (`scribe_v1`, override with
`ELEVENLABS_STT_MODEL_ID`) times every spoken word, and `src/lib/segment.mjs`
picks the cuts. A cut never lands inside a word; the strongest cut is a speech
pause containing a screen change, then a long pause after a sentence end, then
a screen change between words. A dynamic program keeps scenes between 12 and
45 seconds, close to 25. Each scene's narration is the words spoken in it,
fillers ("äh", "ähm", "um") removed; its title is a shortened first sentence
— a working title to refine. Without audio or without an ElevenLabs key the
video is cut at screen changes only and the narration stays empty.
Intermediates (`cuts.json`, `transcript.json`, `analysis.json`, `demo.json`)
stay in the upload directory, so a re-analysis does not pay for the
transcript again.

**Record** cuts each clip out of the upload, scaled and padded to the
composition's 1920×1080, and retimed to the re-voiced narration: the footage
from `voiceAtMs` to the end plays uniformly faster or slower (0.8×–2.5×) until
it matches `narration + holdAfterMs`, so every click stays with its sentence;
what is still missing is a held last frame. A silent lead-in longer than three
seconds becomes a timelapse (the composition's ▶▶ fast-forward), and the
voice-over starts where it ends — where the author's own voice started.
Render is unchanged.

The upload belongs to the demo: `delete-demo` removes it too. An exported
`demo.yaml` does not contain the video — import it elsewhere and the record
stage says the source video is missing; upload it there again.

### Converting a video demo into filmed scenes

**Convert to filmed scenes** (pipeline toolbar; the `convert-video` action;
`node tools/run-demo.mjs <demo-id> --stages=convert` from a shell) turns the
clip scenes of a video demo into scenes Playwright films in the live
application — sharp, reproducible, and re-filmable when the app changes.
`src/lib/convert.mjs`, per clip scene:

1. Keyframes of the clip (its start, every screen change inside it, its end;
   at most eight) and the author's words with their times.
2. The live application at the scene's start — `baseUrl` + `route`, or the
   start page — as a screenshot and Playwright's ARIA snapshot, so selectors
   name elements that exist.
3. Claude (`claude-opus-5-5`; `DEMO_CONVERT_MODEL` overrides) proposes the
   actions, the assertions and the narration with `[cue:…]` markers, as
   structured output that `demoSchema` then validates. With the actions of the
   previous filmed scene, so it can replay the way to where the recording
   continues — navigation only, never sending or saving again.
4. A trial: a fresh signed-in browser runs the actions and assertions at full
   speed. A failure goes back to Claude with the error, a screenshot and a
   snapshot of the page where it failed — at most twice.

A scene whose trial passes gets `mode: film`; its clip stays, so switching
`mode` back to `clip` restores the recording. A scene that still fails stays a
clip, with the last proposal kept as an inert draft and the reason in
`conversion.message`. The result (`<upload>/converted.json`) is saved by the
server like any edit; keyframes and failure shots stay in `<upload>/convert/`.

The trial runs **act in the live application as the signed-in user** — what a
scene sends or saves is really sent, once per trial and again at every
recording. Convert against a demo environment, never production data.

The Anthropic key is the `anthropic-api-key` secret, resolved by the server as
the person who clicked and passed only to the job (`ANTHROPIC_API_KEY` pins it).
A conversion calls Claude once per scene plus once per repair.

### A scene in another application

`baseUrl` on a scene — an absolute URL, "Application URL" in the scene form —
makes the scene run in another application than the demo's
(`settings.baseUrl`), e.g. a change request made in
`https://samples.demo.build.one` and then shown in
`https://platform.demo.build.one`. `route` is resolved against it. A `goto`
action may also take an absolute URL. Before a take, `run-demo.mjs` signs the
browser in to every application the demo names (`B1_BASE_URLS` for
`tools/b1-auth-state.mjs`), so one storage state carries a session for each.

New demos — from **New demo** or **Import video** — point at
`https://samples.demo.build.one/` with an empty `baseUrl.env`, so the host's
`B1_BASE_URL` does not redirect them; set `env` to `B1_BASE_URL` to follow the
host instead.

### Resetting the environment before a take

`settings.resetRepository: true` ("Reset repository before recording" in the
demo form) resets the blueprint repository of the demo's application
(`settings.baseUrl`) before every recording and every conversion — the
changesSearch screen's **Reset repository**: all blueprint changes of that
environment are dropped and the blueprints re-imported from disk
(`POST /service/swat/server-actions/repository/modified-objects/reset-repository`,
with the take's credentials). The take then starts from the environment's
delivered state, whatever an earlier take, a conversion's trial runs or a
customization left behind. Rich text, user roles and other database data stay.
A failed reset stops the recording. It affects everyone using that
environment, and only the demo's own application is reset — not another
application a scene names in `baseUrl`.

### Who a take signs in as: demo users

A Studio author signs in to the Studio as themselves; a recording should sign
in to the target application as a **demo user** — usually a dedicated account
with demo data. Demo users are kept on the Settings screen (**Demo users**):
an id (`samples-demo`), a name, the application it is meant for, and an API
key of that account (created under Account → API keys while signed in as it).
The key goes to the organization's secret store as `demo-factory-user-<id>`
(save-demo-user writes it as the person saving, who must be allowed to write
organization secrets); the Studio keeps only id, name and application, and
never shows the key again. Nobody copies cookies out of browser dev tools.

A demo picks one under **Sign in as** (`settings.demoUser`). When a job of
that demo starts — a recording, a conversion — the server reads the key and
hands it to that job alone as `B1_USER_API_KEY` (and the auth-host scoped
`B1_USER_API_KEY__<HOST>`), with its own auth-state file
(`playwright/.auth/demo-user-<id>.json`), so one user's session never signs in
another's take. The key must be valid on every application the demo's scenes
visit; one key works on all apps of the same auth server. A demo user without
a stored key stops the job with a message. Without `settings.demoUser` the
host's own key is used, as before.

## The live look: inspect-page

`inspect-page` (server action, `src/lib/inspect.mjs`, `cli.mjs inspect`) opens
a page of the target application the way a take would — the demo's
application, its demo user, its viewport — and answers with the page it ended
on: the ARIA snapshot (the roles, accessible names and texts that `role`/`name`
and `text` targets match), a screenshot (`screenshotUrl`, served from
`output/<demo>/inspect-…/page.jpg`) and the URL. Given `actions` and
`assertions` — a scene's own, in the schema's shape — it plays them as fast as
they go (cues ignored, no cursor) and reports the first failing step with the
page as it was at that moment:

```json
{ "demoId": "profile-menu-customize", "route": "/",
  "actions": [{ "action": "click", "target": { "css": "[data-testid=\"user-widget\"]" } }],
  "assertions": [{ "visible": { "role": "menuitem", "name": "Customize" } }] }
```

It is the conversion's trial run as a tool: authors and the Demo Creator agent
write selectors from the snapshot and try each scene before a take. The demo
must exist (it lends the sign-in and base URL); `url` or `baseUrl` reach
another application. One look at a time, refused while a job runs, and it acts
in the live application as the demo user — a draft that saves really saves.

## A video for a new feature: the Demo Creator

The Demo Creator agent (`DemoCreatorAgent`, skill `DemoCreatorSkillDef`) can
author a video for a newly built feature from its ticket: "Create a product
video for B1-1658 in https://samples.demo.build.one/ as demo user
samples-demo". Its Phase 0 reads the Linear ticket through the framework's
`b1-linear` MCP server (as the user, with their `linear-api-key`), the pull
requests the ticket links through `gh pr view`/`gh pr diff` with the sandbox's
`github-token` (read-only; the PR may live in another repository than this
environment's), and the feature's help or knowledge pages. It checks the
feature is deployed in the target application, states the planned scenes,
writes every target from an `inspect-page` snapshot and tries every scene
there, then runs the pipeline. No second agent: the same document contract,
pipeline and rules serve both a free-form request and a feature video.

