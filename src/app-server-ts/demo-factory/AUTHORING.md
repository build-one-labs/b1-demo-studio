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
