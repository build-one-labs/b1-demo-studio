# Tutorial: Ein Demo-Video mit der B1 Demo Factory erstellen

Dieses Tutorial führt einmal komplett durch die Demo Factory: was sie ist, wie
sie funktioniert, und wie du damit Schritt für Schritt ein fertiges Produktvideo
erzeugst — vom leeren Projekt bis zum MP4 mit Voice-over und Untertiteln.

Referenz-Dokumente daneben:

| Dokument | Inhalt |
|---|---|
| `README.md` | Setup, Auth, Provisionierung, Troubleshooting im Detail |
| `AUTHORING.md` | Szenenregeln, alle Actions, Cue-Marker, Timelapse, Setup-Block, Cursor |
| `ARCHITECTURE.md` | Pipeline-Stufen und Timing-Modell |
| `src/schema.mjs` | Der verbindliche Vertrag für `demo.yaml` (Zod-Schema) |
| `demos/b1-vibecode-governance/demo.yaml` | Großes Live-Beispiel (Timelapse, Setup, zwei Apps) |
| `demos/opportunities-map/demo.yaml` | Kleines, verifiziertes Beispiel |

---

## 1. Das Konzept: Demo-as-Code

Ein Demo-Video wird hier nicht aufgenommen, sondern **beschrieben**. Eine
einzige YAML-Datei pro Video — `demos/<demo-id>/demo.yaml` — enthält alles:

- die **Szenen** (welcher Screen, welche Klicks, welche Hervorhebungen),
- das **Voice-over** (der gesprochene Text, Satz für Satz),
- die **Cue-Marker**, die Browser-Aktionen exakt an Wörter im Voice-over binden,
- **Assertions**, die beweisen, dass jede Szene wirklich das gefilmt hat, was
  sie behauptet,
- Branding, Auflösung, Sprache, Stimme.

Daraus erzeugt die Pipeline deterministisch das Video:

```text
demo.yaml → Voice-over + Cue-Timestamps (ElevenLabs)
          → Playwright fährt die Szenen im echten Browser
          → Remotion schneidet Clips, Ton, Titel und Untertitel zusammen
          → MP4 + SRT + run-manifest.json
```

Der Gewinn: Versprecher gibt es nicht, jede Aufnahme ist identisch, und wenn
sich die UI oder der Text ändert, änderst du eine Zeile YAML und renderst neu —
statt 16 Minuten neu einzusprechen.

### Die vier Stufen

1. **Validate** — prüft die YAML gegen das Schema: IDs, Cue-Referenzen, Actions.
2. **Prepare** — erzeugt das Voice-over. Mit ElevenLabs-Key echte Sprache samt
   zeichengenauen Timestamps; ohne Key ein stilles Video mit geschätztem Timing
   und Untertiteln. Narration wird über Content-Hash gecacht — unveränderter
   Text ruft ElevenLabs nie zweimal.
3. **Record** — Playwright öffnet jede Szene in einem **frischen
   Browser-Kontext**, führt die Actions exakt zu ihren Cue-Zeitpunkten aus und
   nimmt den Viewport als WebM auf. Ein synthetischer Cursor fährt sichtbar zu
   jedem Ziel.
4. **Render** — Remotion setzt Clips, Ton, Szenentitel, Untertitel und
   Zeitraffer-Segmente zum finalen MP4 zusammen.

Jede Stufe kann einzeln laufen; `record` kann mit `--scenes=` einzelne Szenen
nachdrehen, ohne den Rest anzufassen.

### Das Timing-Modell (der Kern der Sache)

Im Narration-Text stehen Marker, die nicht gesprochen werden:

```yaml
narration: >
  Hier ist die Pipeline. [cue:show-list] Diese Zeilen kommen live aus
  Salesforce.
actions:
  - action: highlight
    atCue: show-list
    target: { css: '.p-datatable' }
```

ElevenLabs liefert zu jedem Zeichen des gesprochenen Texts einen Timestamp.
Daraus weiß die Pipeline auf die Millisekunde, **wann** die Stimme das Wort
hinter `[cue:show-list]` erreicht — und genau dann feuert die Action. Der
Cursor startet seine Bewegung schon vorher, damit der Klick auf dem Cue landet.

---

## 2. Die zwei Bedienoberflächen

**CLI** (aus `src/app-server-ts`):

```bash
yarn demo:validate <demo-id>     # Schema prüfen
yarn demo:prepare  <demo-id>     # Voice-over erzeugen (--voice=silent erzwingt stumm)
yarn demo:record   <demo-id>     # Browser-Aufnahme (--scenes=a,b für Teilaufnahme)
yarn demo:render   <demo-id>     # Finales MP4
yarn demo          <demo-id>     # Alles in einem: validate → auth → prepare → record → render
yarn demo:publish:web <demo-id>  # Fertigen Run in den public-Ordner der Web-App kopieren
```

**Demo Factory Studio** — die App `b1-demo-factory` im Browser
(`http://localhost:8080/?app=b1-demo-factory`): Storyboard-Editor,
Szenen-Inspektor mit Voice-over- und Actions-Tab, die vier Pipeline-Stufen als
Buttons, Pipeline-Log und Video-Vorschau je Run. Studio und CLI treiben
denselben Code; das Studio zeigt zusätzlich an, was der Host kann (Browser?
ffmpeg? API-Key?) und deaktiviert Stufen, die nicht laufen können — mit Grund.

Im Studio legt **＋** (neben der Demo-Auswahl) ein neues Projekt an — als Kopie
der geöffneten Demo, oder ohne Auswahl von einem leeren Starter-Template.
Der Settings-Tab nimmt Laufzeit-Einstellungen entgegen (`B1_BASE_URL`,
ElevenLabs-Keys, …); Secrets bleiben im Server-Prozess und landen nie im
Blueprint oder in Git.

---

## 3. Voraussetzungen

### Werkzeuge (einmalig pro Workspace)

In einem Codespace richtet `provision-demo-factory.sh` beim Start alles ein.
Nach einem Stack-Neustart einmal nachziehen:

```bash
cd src/app-server-ts && yarn demo:provision
```

Das installiert Chromium + ffmpeg in den App-Server-Container, legt Playwrights
ffmpeg in `.cache/ms-playwright` ab und schreibt `demo-factory/.env.app-server`.

### Voice-over: ElevenLabs

Zwei Werte, ohne die das Video stumm (aber untertitelt) bleibt:

- `ELEVENLABS_API_KEY` — der API-Key
- `ELEVENLABS_VOICE_ID` — die Stimme

Als **Codespace-Secrets** anlegen (Repo → Settings → Codespaces); das Skript
`.devcontainer/scripts/app-server-secrets.mjs` reicht sie beim Start in den
App-Server-Container weiter (nach dem Anlegen einmal von Hand ausführen).
Alternativ im Studio-Settings-Tab eintragen — gilt dann bis zum nächsten
Server-Neustart. Optional: `ELEVENLABS_MODEL_ID` (Default
`eleven_multilingual_v2`).

### Authentifizierung der Aufnahme

Der Aufnahme-Browser muss eingeloggt sein. Drei Wege, in dieser Reihenfolge
probieren:

1. **Session-Cookie** (funktioniert immer, auch gegen fremde Deployments): Im
   eingeloggten Browser DevTools → Application → Cookies → `b1.session_token`
   kopieren, dann:
   ```bash
   cd src/app-server-ts
   B1_BASE_URL=https://<zielhost>/ node demo-factory/tools/auth-from-session.mjs <token>
   export B1_AUTH_STATE=demo-factory/playwright/.auth/b1-demo-user.json
   ```
2. **API-Key-Header**: `B1_USER_API_KEY` gesetzt → `record` schickt ihn als
   `x-api-key` an jede Anfrage. Funktioniert nur, wenn der Ziel-App-Server
   Header-Auth akzeptiert.
3. **Handoff-Mint** (`yarn demo:auth:workspace`): braucht einen Auth-Server mit
   `x-api-key`-Handoff — bei älteren Deployments 401.

Schnelltest, was ankommt: `node demo-factory/tools/probe-auth.mjs <url>` sagt,
ob der Browser die App-Shell oder die Sign-in-Seite sieht.

### Die Ziel-URL

`B1_BASE_URL` **muss den App-Query tragen** — `http://localhost:8080` allein
filmt die Default-App. Richtig: `http://localhost:8080/?app=sample-app`. Eine
Demo kann in `settings.baseUrl.env` auch einen eigenen Variablennamen
deklarieren (z. B. `B1_VIBECODE_BASE_URL`), damit der Workspace-Default sie
nicht übersteuert.

---

## 4. Schritt für Schritt zum Video

### Schritt 1 — Die Geschichte festlegen

Vor der ersten Zeile YAML: Was ist die Aussage, und was ist der sichtbare
Beweis? Eine gute Szene (aus `AUTHORING.md`):

- 15–45 Sekunden (Live-Szenen mit Timelapse dürfen länger sein)
- eine Aussage, ein sichtbarer Beleg
- höchstens drei wesentliche Interaktionen
- eindeutiger Anfangs- und Endzustand
- **keine Abhängigkeit vom UI-Zustand einer anderen Szene** — jede Szene startet
  in einem frischen Browser-Kontext

3–5 Szenen sind ein Produktvideo. Ein 10-Minuten-Video wie
`b1-vibecode-governance` kommt mit 8 aus.

### Schritt 2 — Prüfen, dass Screens und Daten existieren

Der am häufigsten übersprungene Schritt, und der teuerste: **jeden Screen im
laufenden Ziel-System öffnen**, bevor du ihn beschreibst. Liefert die
Datenquelle Zeilen? Rendert das Feld, über das du sprichst, echte Werte (oder
`$NaN`, `***********`, eine leere Achse)? Was leer oder kaputt rendert, wird
umschifft oder vorher gefixt — nie gefilmt.

### Schritt 3 — Das Projekt anlegen

Im Studio: **＋** → ID (`kleinbuchstaben-mit-strichen`) und Titel vergeben.
Oder von Hand: `demos/<id>/demo.yaml` anlegen — am schnellsten als Kopie eines
Beispiels; der `settings`-Block von `opportunities-map` ist gegen diesen
Workspace verifiziert. Die ID muss dem Verzeichnisnamen entsprechen.

### Schritt 4 — Szenen schreiben

Pro Szene: `id`, `title` (wird als Zwischentitel eingeblendet), `route`
(beginnt mit `/`, darf `?app=…` tragen), `narration` mit Cue-Markern,
`actions`, `assertions`.

**Actions**: `goto`, `click`, `dblclick`, `fill`, `type` (tippt sichtbar,
`delayMs` pro Zeichen), `press`, `hover`, `highlight`, `waitFor` (optional mit
`timelapse` und/oder `stableMs` — das Ziel muss so lange ununterbrochen
sichtbar bleiben, gegen flackernde Zustände wie einen Status-Chip, der
zwischen Agent-Schritten kurz „Ready" zeigt), `screenshot`. Jede Action bindet
an `atCue` (oder `atMs`), optional verschoben um `offsetMs` — `offsetMs` wirkt
nur zusammen mit `atCue`/`atMs`.

**Selektoren**, in dieser Reihenfolge:

1. `demoId:` — ein `data-demo-id`-Attribut. Der stabile Vertrag mit der App.
2. `role:` + `name:` — z. B. `{ role: button, name: Create private draft }`
3. `label:` / `text:`
4. `css:` — letzter Ausweg, bricht zuerst

**Jeden Selektor vor der Aufnahme gegen die laufende App prüfen.** Ein aus dem
Quellcode geratener Selektor ist die häufigste Ursache für eine Szene, die eine
leere Seite filmt.

**Assertions** ans Szenenende — der Beweis, dass gefilmt wurde, was behauptet
wird:

```yaml
assertions:
  - visible: { css: '.leaflet-marker-icon >> nth=0' }
  - textContains: { target: { css: '.p-datatable' }, value: 'Negotiation' }
```

### Schritt 5 — Live-Abschnitte mit Timelapse

Wenn im Video echte, unvorhersehbar lange Arbeit passiert (ein Agent baut eine
App, eine Analyse läuft), nimm sie live auf und lass den Render sie raffen:

```yaml
narration: >
  Der Agent legt los. [cue:working] Er analysiert Datenquellen und Bausteine
  und setzt die App zusammen. [cue:done] Fertig — hier ist das Ergebnis.
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

Die Aufnahme wartet echt (bis `timeoutMs`); der Render komprimiert genau dieses
Stück auf das Narrations-Budget zwischen `working` und `done` — mit
▶▶-Badge im Bild. Details in `AUTHORING.md`.

### Schritt 6 — Ausgangszustand automatisieren (Setup-Block)

Wenn eine Aufnahme das System verändert (Live-Demos!), stellt ein `setup`-Block
vor jeder Vollaufnahme den bekannten Ausgangszustand her — ungefilmt:

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

### Schritt 7 — Validieren und Voice-over prüfen

```bash
yarn demo:validate <id>                 # nach jeder Änderung, kostet nichts
yarn demo:prepare <id> --voice=silent   # zeigt die Länge jeder Szene in Sekunden
```

Die Prepare-Ausgabe ist dein Längen-Budget: Szenenlängen addieren, Holds
(~2,5 s je Szene) dazurechnen — das ist die Videolänge. Text kürzen ist hier
eine YAML-Zeile; nach der Aufnahme ist es ein Neudreh.

### Schritt 8 — Aufnehmen

```bash
yarn demo <id>          # alles in einem, ODER:
yarn demo:prepare <id>  # echtes Voice-over (Cache greift bei unverändertem Text)
yarn demo:record <id>   # die Aufnahme
```

`record` schreibt in den **neuesten** Run — `prepare` muss also vorher gelaufen
sein. Schlägt eine Szene fehl, liegt ein Screenshot des Fehlmoments neben den
Clips (`clips/<szene>.failure.png`). Einzelne Szenen nachdrehen:

```bash
yarn demo:record <id> --scenes=szene-a,szene-b
```

— aber nur auf Basis eines Runs, dessen Aufnahme **vollständig** war, und
wohlwissend, dass der `setup`-Block bei Teilaufnahmen übersprungen wird.

### Schritt 9 — Rendern und veröffentlichen

```bash
yarn demo:render <id>
```

(In kleinen Workspaces sind `REMOTION_OFFTHREADVIDEO_CACHE_MB=512` und
`REMOTION_CONCURRENCY=1|2` bereits die Defaults der Provisionierung; ohne Cap
stirbt ein 1080p-Render mit `Compositor exited with signal SIGTERM`.)

Ergebnis in `output/<id>/<run-id>/`: `<id>.mp4`, `<id>.srt`,
`run-manifest.json`. `yarn demo:publish:web <id>` kopiert den Run in die
Web-App; im Studio erscheint er in der Vorschau.

---

## 5. Ohne Codespace: die Demo Factory im deployten Stack

Ein deployter Stack dieses Repos ist eine vollständige Video-Werkbank — ohne
Git, ohne Shell. Die Unterschiede zum Workspace-Betrieb:

- **Demos liegen in Datenquellen** (persistent in der Blueprint-DB); die
  YAML-Datei ist nur die Arbeitskopie der Pipeline. Runs und der
  Narration-Cache liegen auf dem Volume `demo_factory_data`; Cache und
  Run-Manifeste sind zusätzlich in Postgres gespiegelt
  (`demo_narration_cache`, `demo_run_manifests`) — ein Redeploy kauft kein
  Voice-over neu.
- **Export/Import**: ⤓ exportiert die offene Demo als `demo.yaml`
  (Backup- und Transferformat, Kommentare bleiben erhalten, solange Zeilen und
  Datei übereinstimmen); ⤒ importiert eine YAML per Paste — validiert wie
  jede Studio-Änderung, mit Kollisionswahl (ablehnen / überschreiben / als
  Kopie).
- **Download**: MP4/SRT-Buttons neben der Vorschau und in der Runs-Tabelle
  (`…/media/<demo>/<run>/download/<datei>`).
- **Auth ohne Shell**: Im Settings-Tab das `b1.session_token`-Cookie einer
  eingeloggten Browser-Session einfügen → „Mint auth state" schreibt den
  Playwright-Auth-State serverseitig und setzt `B1_AUTH_STATE`.
- **Zugriffsschutz**: `DEMO_FACTORY_OPERATORS` (Komma-Liste von E-Mails) im
  Stack-Environment beschränkt alle verändernden Actions auf die gelisteten
  Konten; ungesetzt = offen (Workspace-Verhalten).
- **Demo Creator direkt aus dem Studio**: Der 🗨-Button startet eine
  Konversation mit dem Agenten gegen diese Umgebung — er liest über
  `query_data_source`, schreibt ausschließlich über `save-demo` und fährt die
  Pipeline über `start-job`/`job-status`.

---

## 6. Troubleshooting

| Symptom | Ursache | Fix |
|---|---|---|
| `Invalid demo id` | Großbuchstaben/Unterstriche | `^[a-z0-9][a-z0-9-]*$`, gleich dem Verzeichnis |
| Validate meckert Cue an | `atCue` ohne Marker in der Szene | Marker sind pro Szene, nicht pro Demo |
| Falsche App gefilmt | `B1_BASE_URL` ohne `?app=` | App-Query anhängen |
| Sign-in-Seite gefilmt | keine Auth | Session-Cookie / `B1_USER_API_KEY` (Abschnitt 3) |
| Szene ist leer | Selektor traf nie | im laufenden System prüfen; `data-demo-id` bevorzugen |
| Szene klappt allein, nicht in Folge | Abhängigkeit von anderer Szene | jede Szene startet frisch |
| Render stirbt (`SIGTERM`) | Frame-Cache ohne Cap | `REMOTION_OFFTHREADVIDEO_CACHE_MB=512`, `REMOTION_CONCURRENCY=2` |
| Render stoppt still nach `Selecting composition` | `nest --watch` killte den Render | `watchOptions.excludeDirectories` in `tsconfig.json` prüfen |
| `record` findet keinen Run | `prepare` fehlt oder letzter Run abgebrochen | `prepare` erneut |
| Tote Luft im Video | echte Wartezeit ungerafft | `timelapse: true` auf das `waitFor` |

Logs: aus der Shell ist stdout das Log; aus dem Studio landet es im Log-Panel
**und** in `output/logs/<zeit>--<demo>--<stufe>.log` (übersteht Server-Neustarts,
`tail -f` funktioniert).

---

## 7. Die Demo-Projekte in diesem Repo

- **`b1-vibecode-governance`** — das 10-Minuten-Produktvideo (Vibe Coding +
  Governance), live gegen `vanguard-develop.test.build.one` aufgenommen. Nutzt
  alles aus diesem Tutorial: `type`, Timelapse, Setup-Reset, App-Wechsel per
  Szenenschnitt und per `goto`.
- **`opportunities-map`** — klein, lokal verifiziert, guter Startpunkt zum
  Kopieren.
- **`sales-tour-planning`** — Authoring-Referenz (der Ziel-Screen existiert in
  diesem Blueprint nicht; validiert und rendert, nimmt hier aber nicht auf).
