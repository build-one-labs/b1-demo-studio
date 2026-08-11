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
- `fill`
- `press`
- `hover`
- `highlight`
- `waitFor`
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

## Synthetischer Cursor

Der Cursor wird fÃ¼r `click`, `fill`, `press`, `hover` und `highlight` automatisch zum Ziel-Element bewegt. Die Bewegung beginnt vor dem Cue, sodass die eigentliche Action weiterhin exakt zum Cue ausgefÃ¼hrt wird. Klicks erhalten einen sichtbaren Ripple.

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
