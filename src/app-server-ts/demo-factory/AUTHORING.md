# Demo-Autorierung

## Gute Szenen

- 15 bis 45 Sekunden lang
- eine Aussage und ein sichtbarer Beleg
- höchstens drei wesentliche Interaktionen
- eindeutiger Anfangs- und Endzustand
- keine Abhängigkeit vom Zustand einer vorherigen Szene

## Unterstützte Actions

- `goto`
- `click`
- `dblclick` — Doppelklick, z. B. zum Öffnen einer Karte, die ein Einzelklick nur selektiert
- `fill`
- `type` — wie `fill`, aber Zeichen für Zeichen (`delayMs` pro Tastenanschlag, Default 35). Für Prompts, die sichtbar geschrieben werden sollen.
- `press`
- `hover`
- `highlight`
- `waitFor` — optional mit `timelapse` (siehe unten), `stableMs` und/oder
  `retry`. `stableMs`: das Ziel muss so viele Millisekunden ununterbrochen
  sichtbar bleiben, bevor der Wait als erfüllt gilt — für Zustände, die
  zwischendurch flackern (z. B. ein Status-Chip, der zwischen Agent-Schritten
  kurz „Ready" zeigt). `retry: { target, everyMs }`: ein Rettungsklick —
  solange das eigentliche Ziel fehlt, wird das Retry-Ziel geklickt, wann immer
  es sichtbar ist (höchstens alle `everyMs`, Default 45 s) — für
  Live-Umgebungen, die transient scheitern und einen Retry-Button anbieten
- `screenshot`

Targets werden bevorzugt so angegeben:

```yaml
target:
  demoId: object-type-service
```

Alternativ sind `role` plus `name`, `label`, `text` oder CSS für Legacy-UIs möglich. CSS ist nur der letzte Fallback.

## Cue-Marker

```yaml
narration: >
  Aus dem Golden Path entsteht ein konkreter Graph.
  [cue:show-graph] Hier sehen wir den Payment Service.

actions:
  - action: click
    atCue: show-graph
    target:
      demoId: navigation-object-graph
```

Cue-Marker werden nicht gesprochen. Jede referenzierte Cue-ID muss im Narration-Text derselben Szene vorkommen.

## Timelapse: live warten, komprimiert abspielen

Ein `waitFor` mit `timelapse` nimmt eine echte, unvorhersehbar lange Wartezeit
(ein Agent baut eine App, eine Analyse läuft) in Echtzeit auf — und der Render
spielt genau dieses Stück beschleunigt ab, mit einem ▶▶-Badge im Bild:

```yaml
narration: >
  Der Agent beginnt zu arbeiten. [cue:agent-works] Er analysiert Datenquellen
  und Bausteine und setzt die App zusammen. [cue:agent-done] Und hier ist das
  Ergebnis.

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

Die komprimierte Länge ist das Budget der Narration: der Abstand vom Cue des
Waits bis zum nächsten Cue-gebundenen Action (`agent-works` → `agent-done`).
So landet das Bildmaterial nach dem Wait wieder exakt auf seinem Cue. Ein
explizites `timelapse: { targetMs: 8000 }` überschreibt das Budget; ohne
nachfolgende Action sind es 6 Sekunden. Dauert die echte Wartezeit weniger als
das Budget, wird nichts komprimiert.

Die Narration zwischen den beiden Cues läuft normal weiter — sie beschreibt,
was im Zeitraffer zu sehen ist.

## Setup: Zustand herstellen, ohne zu filmen

Ein optionaler `setup`-Block auf Demo-Ebene läuft vor der ersten Szene in
einem eigenen, nie aufgenommenen Browser-Kontext — für Repository-Resets,
Seed-Daten oder das Wegklicken von Erst-Dialogen:

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

Ohne Narration gibt es keine Cues: Actions laufen der Reihe nach, jede sobald
die vorherige fertig ist. Bei `--scenes=`-Teilaufnahmen wird `setup`
übersprungen — wer eine einzelne Szene nachdreht, will den Zustand behalten,
den die übrigen Szenen hinterlassen haben.

## Synthetischer Cursor

Der Cursor wird für `click`, `fill`, `type`, `press`, `hover` und `highlight` automatisch zum Ziel-Element bewegt. Die Bewegung beginnt vor dem Cue, sodass die eigentliche Action weiterhin exakt zum Cue ausgeführt wird. Klicks erhalten einen sichtbaren Ripple.

Globale Einstellungen liegen in `settings.cursor`:

```yaml
cursor:
  enabled: true
  moveDurationMs: 700
  clickLeadMs: 120
  clickEffectDurationMs: 560
  sizePx: 30
```

Da die Zielposition aus dem `data-demo-id`-Element berechnet wird, sind keine Bildschirmkoordinaten in der Demo-Definition erforderlich.

## UI-Automatisierungsvertrag

B1 sollte für demo-relevante Interaktionen stabile IDs bereitstellen:

```html
<button data-demo-id="navigation-object-types">Object Types</button>
<section data-demo-id="object-graph">...</section>
```

Layout und CSS dürfen sich ändern, solange diese semantischen IDs bestehen bleiben.
