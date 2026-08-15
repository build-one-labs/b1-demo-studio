# Architektur

## Source of Truth

Jede Demo besitzt genau eine YAML-Definition. Sie enthält Szenen, Voice-over, Cue-Marker, Browseraktionen, Assertions, Branding und Output-Einstellungen.

## Pipeline

1. **Validate:** Schema, Cue-Referenzen, IDs und Actions prüfen.
2. **Prepare:** Voice-over erzeugen oder aus Cache laden; Cue- und Caption-Timestamps ableiten.
3. **Record:** Szenen unabhängig per Playwright aufnehmen. Aktionen werden an Cue-Zeitpunkte gebunden.
4. **Compose:** Clips, Voice-over, Titel, Callouts und Captions per Remotion zusammensetzen.
5. **Publish:** MP4, SRT und Run Manifest als CI-Artefakte speichern.

## Wartbarkeit

- Szenen werden einzeln aufgenommen und können separat regeneriert werden.
- Selektoren werden über `data-demo-id` und Page-Semantik stabilisiert.
- Narration wird über Content Hash gecacht.
- Auth State, API Keys und Cookies liegen nie im Repository.
- Jede Browseraktion besitzt eine nachgelagerte Assertion.
- Die lokale Fixture dient als Contract-Test für Runner und Video-Pipeline.

## Timing

Inline-Marker wie `[cue:open-service]` werden vor der Spracherzeugung entfernt. Ihre Zeichenposition wird mit der von ElevenLabs gelieferten Alignment-Timeline auf Sekunden abgebildet. Eine Action mit `atCue: open-service` startet zu diesem Zeitpunkt. Ohne ElevenLabs wird ein deterministisches Timing aus Textlänge und Sprechgeschwindigkeit geschätzt.

## Produktionspfad

Der interaktive Browser dient zum Erkunden und erstmaligen Autorieren. Release-Videos werden ausschließlich über versionierte Playwright-Actions erzeugt. Das ermöglicht CI-Runs, reproduzierbare Videos und schnelle Anpassungen an neue B1-Versionen.

