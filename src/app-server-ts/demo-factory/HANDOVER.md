# Hand-over: Demo Factory im Deployment — Stand & Weiterbau

Für den nächsten Agenten (oder Menschen), der hier weiterbaut. Stand
22\. Aug 2026, Branch `feature/demo-factory-deployed` (gestapelt auf
`feature/vibecode-governance-demo`, PR #8). Der Gesamtplan mit Architektur
und Phasen: https://claude.ai/code/artifact/8feb05e4-560c-48ef-b67a-fd1da94ff4dc

## Was fertig ist (dieser Branch)

| Baustein | Wo | Zustand |
|---|---|---|
| `DEMO_CACHE_DIR` (Narration-Cache konfigurierbar) | `src/lib/files.mjs` (`resolveCacheRoot`), `narration.mjs`, `demo-factory.lib/host.ts` | ✅ getestet |
| Narration-Cache in Postgres (`demo_narration_cache`, bytea-Audio) | `demo-factory.narration-cache.ts`, Migration `drizzle/0014_*` | ✅ restore vor prepare/all, ingest danach; best-effort, blockt nie einen Job |
| Run-Manifeste in Postgres (`demo_run_manifests`) | `demo-factory.run-ingest.ts` (`persistManifest`) | ✅ Upsert bei jedem Reconcile |
| Export/Import/Save als Dokument | `demo-factory.transfer.ts` + Actions `export-demo` / `import-demo` / `save-demo` | ✅ Jest-Spec `demo-factory.transfer.spec.ts`; Schreiben läuft IMMER durch die Materializer-Hooks (Validierung) |
| Download-Endpunkte | `demo-factory.media.controller.ts` (`…/download/:file`, Subdir-Route für `narration/…` — behebt nebenbei 404 der Narration-URLs) | ✅ |
| Auth ohne Shell (`mint-auth-state`) | Action in `demo-factory.actions.ts`, UI im Settings-Tab | ✅ schreibt Storage-State unter `<outputRoot>/auth/`, setzt `B1_AUTH_STATE` |
| Operator-Guard | `assertOperator` in `demo-factory.lib.ts`, Env `DEMO_FACTORY_OPERATORS` | ✅ ungesetzt = offen; Interim bis Melange |
| Studio-UI | `DemoFactoryStudio.vue`: ⤓ Export, ⤒ Import-Dialog, MP4/SRT-Downloads, Session-Token-Mint, 🗨 Agent-Dialog | ✅ Lint grün |
| Agent → Umgebungs-Modus | `DemoCreatorAgent.json` (`agentEnvironment: ""`), Prompt-Clob `27043fb7…`, Skill-Clob `43fb802c…` (beide MCP-orientiert neu geschrieben) | ✅ Inhalt; **E2E ungetestet** (s. u.) |
| Studio → Agent-Konversation | `startAgentConversation()` via `agent-proxy/create-conversation` mit `agentObjectMasterGuid` `34e589aa-…` | ✅ Code; **E2E ungetestet** |
| Deployment-Layer | `.build/deploy/standalone.deployment.config.json`: Volume `demo_factory_data` → `/data/demo-factory`, `DEMO_OUTPUT_DIR`/`DEMO_CACHE_DIR`, ELEVENLABS-/OPERATORS-Env | ✅ (Achtung: `.deploy/` ist generiert und gitignored — Quelle ist `.build/deploy/`) |
| `setup:`-Block-Roundtrip-Fix | `rows.ts`, `transfer.ts`, `DemoFactoryStudio.vue` | ✅ der Rows-Spec hatte gefangen, dass `setup` beim Dokument↔Zeilen-Split verloren ging |

Tests: `yarn test` in `src/app-server-ts` (24 Jest + 19 Node), Build und beide
Lints grün. Migration 0014 ist gegen die Workspace-DB angewendet.

## Was offen ist — konkrete nächste Schritte

1. **`execute_action` (Plattform, nicht dieses Repo).** Entscheidung von Mike:
   generisches MCP-Tool `execute_action(service, action, payload)` + Discovery
   `list_actions` — Spezifikation steht im Plan-Artefakt (Routing auf
   `/service/app/{service}/{action}`, Nutzer-Identität, Fehler-Body
   durchreichen). Bis es existiert, kann der Agent die Actions nur über das
   Terminal seiner Umgebung erreichen; der Skill-Clob formuliert das bereits so.
   → Ticket an das Plattform-Team; dieses Repo ist der erste Abnehmer.
2. **Agent-E2E-Test.** `agentEnvironment: ""` + `create-conversation` mit
   `environmentUrl` ist dokumentationskonform, aber nie gegen eine echte
   Umgebung gefahren. Prüfen: (a) landet die Konversation im Environment-Modus,
   (b) existiert `/screens/agentChatScreen` in dieser Blueprint (die Navigation
   im Studio nimmt das an), (c) welche Auth trägt das Agent-Terminal für
   Action-POSTs. Fallbacks im Code sind benannt (`conversationId`-Feldname).
3. **Melange statt Operator-Allowlist.** `DEMO_FACTORY_OPERATORS` ist ein
   Interim. Ziel: `.fga`-Modell + `@MelangeCheck` auf den mutierenden Actions
   (Skill `b1-melange-authorization` beschreibt den Weg). Die Allowlist danach
   entfernen oder als Zusatzfilter behalten — bewusst entscheiden.
4. **Blueprint-Import in Bestandsumgebungen.** Die geänderten Clobs
   (Prompt/Skill) und das Agent-Objekt liegen in `src/data`. Eine *bestehende*
   Umgebung importiert `src/data` nicht neu (`IMPORT_DATA=false` im Workspace) —
   dort die Objekte per `b1`-Import bzw. Blueprint-MCP nachziehen.
5. **Voll-Migration der Demo/Scene/Run-DSOs nach Postgres** (Plan Phase 4).
   Bewusst NICHT begonnen: die clob-DSOs persistieren bereits, und die
   Validierung hängt an ihren Server-Event-Hooks. Wer das angeht: Hooks für
   entity-DSOs klären, `schema-to-blueprint` nutzen, `store.ts` ist die einzige
   Zugriffsschicht (ein Tausch-Punkt).
6. **Artefakt-Speicher-Option S3** (Plan Phase 4): Volume bleibt Default;
   presigned Downloads wären der nächste Ausbau. Braucht eine
   Infrastruktur-Entscheidung.
7. **`.deploy`-Workspace-Kopie**: Meine Volume/Env-Änderung wurde zusätzlich in
   die lokale (generierte) `.deploy/standalone.*` geschrieben — beim nächsten
   `npx b1 deploy`-Generat kommt sie aus `.build/deploy/` ohnehin; nichts zu tun,
   nur nicht wundern.

## Fallstricke, die dich sonst Stunden kosten

- **Schreiben an den Hooks vorbei wedgt die Factory.** Demo/Scene-Zeilen NIE
  direkt committen (auch nicht per `write_clob` über den Blueprint-MCP): nur
  der Commit-Pfad des App-Servers feuert die Materializer-Validierung.
  `save-demo`/`DemoFactoryTransfer.saveDocument` ist der einzige Schreibweg;
  interne Seed-Writes markieren sich mit `INTERNAL_WRITE` (CLS).
- **Commit-Reihenfolge in `saveDocument`**: Demo-Zeile → Scene-Creates/Updates
  → Scene-Deletes. Jede Zwischenstufe muss für die per-Record-Hooks valide
  sein; die Spec `demo-factory.transfer.spec.ts` pinnt das.
- **`.deploy/` ist generiert und gitignored** — getrackte Quelle ist
  `.build/deploy/`. Ein Edit in `.deploy/` verschwindet beim nächsten Generat.
- **Workspace-Container-Neustart verliert chromium/ffmpeg** →
  `yarn demo:provision`. Der Studio-Capability-Check zeigt es an.
- **`yarn demo` (all-in-one) mintet den Auth-State neu** und kann einen per
  Cookie gebauten State für einen Fremdhost überschreiben — für Demos gegen
  fremde Umgebungen die Stufen einzeln fahren (steht auch im Kopf von
  `demos/b1-vibecode-governance/demo.yaml`).
- **Sandbox-Kapazität** ist die häufigste Live-Demo-Fehlerquelle: hängende
  Sandboxen vor einem Take löschen, Umgebung während des Takes nicht parallel
  benutzen. `retry:` auf den Sandbox-Waits heilt Transientes.
- **Ein App-Server-Replica.** Das Job-Modell ist single-process; der
  Start-Reconcile schließt verwaiste `running`-Jobs.

## Verifizieren nach Änderungen

```bash
cd src/app-server-ts
yarn test                 # Jest + demo-factory Node-Tests
yarn build && yarn lint
yarn demo:validate b1-vibecode-governance
cd ../web-app && yarn lint
```

Für einen echten End-to-End-Beweis: Studio öffnen (`?app=b1-demo-factory`),
Export → Import als Kopie → Kopie löschen; MP4-Download eines Runs; Session-
Token minten und `Run full demo` gegen die eigene Umgebung.
