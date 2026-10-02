# Build with Jev — Enterprise (Mike v7)

Diese Demo ist im Studio unter der ID `build-with-jev-apps-mike-v7-enterprise` importiert. Das ursprüngliche `build-with-jev-apps` wurde nicht verändert.

Grundlage: `tmp/build-with-jev-apps-mike-v7-enterprise.mp4`, 165,434 Sekunden, 1920 × 1080, 30 fps. Der Sprechertext stammt aus der eingebetteten Untertitelspur und wurde mit einer Transkription abgeglichen. Die Bilder wurden in Abständen von fünf Sekunden und an den relevanten Stellen geprüft.

| Szene | Bereich in der Referenz | Inhalt |
|---|---|---|
| built-on-demand | 0:00–0:13 | Fertige App mit ausgewähltem Kunden und Ergebnis-Banner |
| prompt-to-enterprise-app | 0:13–1:18 | Prompt eingeben, App erzeugen, Karte zeigen, Kunden auswählen; Benutzerrechte und Team-Workflows |
| approved-building-blocks | 1:18–1:55 | Katalog, Erweiterungen aus Schemas/APIs, Freigabe durch IT |
| generation-breakdown | 1:55–2:35 | Zweite Generierung, Jev-Auswahl, B1-Komponenten, Zeitmessung, keine LLM-Aufrufe |
| next-enterprise-workflow | 2:35–2:45 | Zurück zur fertigen App und Abschluss-Banner |

## Im Studio bearbeiten

- Szene über ihren Titel öffnen; Sprechertext im Narration-Tab bearbeiten.
- Actions enthält die rekonstruierten Klicks, Highlights und Cue-Zeitpunkte.
- Textbanner sind `callout`-Aktionen: `value` ist der sichtbare Text. Ohne `durationMs` bleibt ein Banner bis zur nächsten Einblendung oder zum Szenenende. Eine leere Zeichenfolge entfernt es.
- `atCue` bindet die Aktion an eine Marke im Sprechertext. Nach Textänderungen die Cue-Marken prüfen.
- Szene speichern und schließen. Für Änderungen per Agent die Zeile auswählen und **Edit with Demo Agent** öffnen.
- Danach Voiceover vorbereiten, aufnehmen und rendern; am einfachsten **Run full demo**.

## Was sich bei einer neuen Aufnahme unterscheiden kann

Die Demo verwendet echte Browser-Aktionen und neu generierbare Sprache. Sie enthält keine Ausschnitte der MP4 als festes Bildmaterial. Englischer Sprechertext, Bildfolge, Highlights und Banner sind rekonstruiert; Stimme, Pausen, Ladezeiten und die exakte Schnittlänge sind nicht aus einer MP4 als editierbare Quelldaten zurückzugewinnen.

**477 ms** im Sprechertext ist die Messung des damaligen Referenz-Runs. Der Test am 1. Oktober 2026 ergab 348 ms. Neue Aufnahmen messen erneut; den Text in **generation-breakdown** vor Veröffentlichung mit der angezeigten Zeit abgleichen oder allgemein formulieren.

Auftakt und Abschluss öffnen die eigens für diese Rekonstruktion erzeugte App `JevSalesforceOpportunityScreen20261001154650` in `enterprise-ai.demo.build.one`. Sie ist eine Abhängigkeit der Demo. Nach einem Reset dieser Ziel-Umgebung eine entsprechende App erzeugen und die Routes beider Szenen aktualisieren. Die beiden Generierungsszenen erzeugen bei der Aufnahme neue Apps.

Die Zieladresse wird aus `JEV_DEMO_BASE_URL` gelesen, falls diese Variable gesetzt ist, ansonsten aus dem Enterprise-Fallback. Die vorhandene Anmeldung muss für diese Umgebung gültig sein. Im Studio konfiguriertes `B1_BASE_URL` wird weiterhin bei der Vorbereitung einer API-Key-Anmeldung verwendet; es muss ebenfalls zur Ziel-Umgebung passen.

## Prüfung

Alle fünf Szenen wurden in jeweils einem frischen authentifizierten Browserkontext gegen die Ziel-App getestet: 43 Aktionen und die Szenen-Assertions bestanden. Die Tests führten die Aktionen ohne Sprecher-Wartezeiten aus; ein neuer vollständiger Voiceover-/Aufnahme-/Render-Durchlauf wurde noch nicht gestartet. Die 38 Factory-Tests einschließlich Banner-Validierung, sicherer Textausgabe und Ablauf der Einblendungen bestanden ebenfalls.

Analyse-Dateien und Screenshots liegen in `tmp/jev-v7-analysis/`; sie gehören nicht zum Demo-Bauplan.
