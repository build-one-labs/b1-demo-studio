# Architecture

## Source of truth

Every demo has exactly one YAML definition. It holds the scenes, voice-over,
cue markers, browser actions, assertions, branding and output settings.

## Pipeline

1. **Validate:** check the schema, cue references, ids and actions.
2. **Prepare:** synthesize the voice-over or load it from cache; derive cue and
   caption timestamps.
3. **Record:** record each scene independently with Playwright. Actions are
   bound to cue timestamps.
4. **Compose:** assemble clips, voice-over, titles, callouts and captions with
   Remotion.
5. **Publish:** store the MP4, SRT and run manifest as CI artifacts.

## Maintainability

- Scenes are recorded individually and can be regenerated separately.
- Selectors are stabilized through `data-demo-id` and page semantics.
- Narration is cached by content hash.
- Auth state, API keys and cookies never live in the repository.
- Every browser action has a trailing assertion.
- The local fixture serves as the contract test for the runner and the video
  pipeline.

## Timing

Inline markers like `[cue:open-service]` are removed before speech synthesis.
Their character position is mapped to seconds using the alignment timeline
ElevenLabs returns. An action with `atCue: open-service` starts at exactly that
moment. Without ElevenLabs, a deterministic timing is estimated from text
length and speaking rate.

## Production path

The interactive browser is for exploring and first-time authoring. Release
videos are produced exclusively through versioned Playwright actions. That is
what enables CI runs, reproducible videos and quick adaptation to new B1
versions.
