<template>
  <HelpLayout
    :title="t('title')"
    :eyebrow="t('eyebrow')"
    :subtitle="t('subtitle')"
    icon="lucide-clapperboard"
    :sections="sections"
  >
    <template #actions>
      <Button :label="t('startHere')" icon="pi pi-arrow-right" icon-pos="right" @click="openOverview" />
    </template>

    <HelpSection id="how" :title="t('navHow')" icon="lucide-workflow" :lead="t('howLead')">
      <p>{{ t('howScenes') }}</p>
      <HelpFlow :nodes="flow" :label="t('flowLabel')" />
      <p><Say k="howRunAll" :ui="L" /></p>
      <p>{{ t('howVideo') }}</p>
      <HelpCallout type="note">{{ t('howNote') }}</HelpCallout>
      <h3>{{ t('screensTitle') }}</h3>
      <HelpCards>
        <HelpCard :title="L.overview" icon="lucide-clapperboard" screen="DemoFactoryHomeScreen">{{
          t('cardHome')
        }}</HelpCard>
        <HelpCard :title="L.demos" icon="lucide-film" screen="DemoFactoryDemoSearch">{{ t('cardDemos') }}</HelpCard>
        <HelpCard :title="L.runs" icon="lucide-history" screen="DemoFactoryRunSearch">{{ t('cardRuns') }}</HelpCard>
        <HelpCard :title="L.settings" icon="lucide-settings" screen="DemoFactorySettingsScreen">{{
          t('cardSettings')
        }}</HelpCard>
      </HelpCards>
    </HelpSection>

    <HelpSection id="ways" :title="t('navWays')" icon="lucide-git-fork" :lead="t('waysLead')">
      <HelpCards>
        <HelpCard :title="L.agent" icon="lucide-sparkles" screen="DemoFactoryAgentScreen">{{
          t('waysAgent')
        }}</HelpCard>
        <HelpCard :title="L.newDemo" icon="lucide-plus" screen="DemoFactoryDemoCreate">{{ t('waysNew') }}</HelpCard>
        <HelpCard :title="L.importVideo" icon="lucide-file-video" screen="DemoFactoryVideoImportScreen">{{
          t('waysVideo')
        }}</HelpCard>
        <HelpCard :title="L.import" icon="lucide-upload" screen="DemoFactoryImportScreen">{{
          t('waysImport')
        }}</HelpCard>
      </HelpCards>
      <h3>{{ t('waysWhichTitle') }}</h3>
      <HelpTerms :items="ways" />
      <p><Say k="waysWhere" :ui="L" /></p>
      <HelpCallout type="tip"><Say k="waysAfter" :ui="L" /></HelpCallout>
    </HelpSection>

    <HelpSection id="setup" :title="t('navSetup')" icon="lucide-wrench">
      <p><Say k="setupLead" :ui="L" /></p>
      <h3>{{ t('setupAppTitle') }}</h3>
      <p>{{ t('setupApp') }}</p>
      <h3>{{ t('setupUserTitle') }}</h3>
      <p><Say k="setupUser" :ui="L" /></p>
      <p><Say k="setupKey" :ui="L" /></p>
      <p><Say k="setupSignIn" :ui="L" /></p>
      <h3>{{ t('setupVoiceTitle') }}</h3>
      <p>{{ t('setupVoice') }}</p>
      <p><Say k="setupHost" :ui="L" /></p>
    </HelpSection>

    <HelpSection id="first" :title="t('navFirst')" icon="lucide-rocket">
      <p><Say k="firstLead" :ui="L" /></p>
      <HelpSteps>
        <HelpStep v-for="step in firstSteps" :key="step" :title="t(`${step}Title`)"><Say :k="step" :ui="L" /></HelpStep>
      </HelpSteps>
    </HelpSection>

    <HelpSection id="buttons" :title="t('navButtons')" icon="lucide-mouse-pointer-click">
      <h3>{{ t('overviewTitle') }}</h3>
      <p><Say k="overview1" :ui="L" /></p>
      <p>{{ t('overview2') }}</p>
      <p>{{ t('overview3') }}</p>
      <h3>{{ t('buttonsTitle') }}</h3>
      <p>{{ t('buttonsLead') }}</p>
      <HelpTerms :items="buttons" />
      <h3>{{ t('menuTitle') }}</h3>
      <p><Say k="menuLead" :ui="L" /></p>
      <HelpTerms :items="userMenuTerms" />
    </HelpSection>

    <HelpSection id="scenes" :title="t('navScenes')" icon="lucide-mouse-pointer-2" :lead="t('scenesLead')">
      <h3>{{ t('cueTitle') }}</h3>
      <p>{{ t('cue') }}</p>
      <h3>{{ t('jsonTitle') }}</h3>
      <p>{{ t('json') }}</p>
      <pre class="demo-factory-help__code">{{ actionExample }}</pre>
      <p>{{ t('target') }}</p>
      <p>{{ t('verbs') }}</p>
      <h3>{{ t('calloutTitle') }}</h3>
      <p>{{ t('callout') }}</p>
      <pre class="demo-factory-help__code">{{ calloutExample }}</pre>
      <h3>{{ t('assertTitle') }}</h3>
      <pre class="demo-factory-help__code">{{ assertionExample }}</pre>
      <p>{{ t('assert') }}</p>
    </HelpSection>

    <HelpSection id="agent" :title="t('navAgent')" icon="lucide-bot" :lead="t('agentLead')">
      <HelpSteps>
        <HelpStep v-for="step in agentSteps" :key="step" :title="''"><Say :k="step" :ui="L" /></HelpStep>
      </HelpSteps>
      <p>{{ t('agentContext') }}</p>
      <blockquote class="demo-factory-help__quote">{{ t('agentEx1') }}</blockquote>
      <blockquote class="demo-factory-help__quote">{{ t('agentEx2') }}</blockquote>
      <p><Say k="agentCheck" :ui="L" /></p>
      <h3>{{ t('featureTitle') }}</h3>
      <p><Say k="feature" :ui="L" /></p>
      <ul>
        <li v-for="item in ['f1', 'f2', 'f3', 'f4'] as const" :key="item">{{ t(item) }}</li>
      </ul>
      <HelpCallout type="warning" :title="t('warnTitle')">{{ t('featureNote') }}</HelpCallout>
    </HelpSection>

    <HelpSection id="voice" :title="t('navVoice')" icon="lucide-audio-lines">
      <p>{{ t('voiceProvider') }}</p>
      <p>{{ t('voiceModel') }}</p>
      <p>{{ t('voiceCache') }}</p>
      <HelpCallout type="tip">{{ t('voiceTiming') }}</HelpCallout>
      <p><Say k="voiceLook" :ui="L" /></p>
    </HelpSection>

    <HelpSection id="results" :title="t('navResults')" icon="lucide-folder-open">
      <p><Say k="res1" :ui="L" /></p>
      <p>{{ t('res2') }}</p>
      <p>{{ t('res3') }}</p>
    </HelpSection>

    <HelpSection id="faq" :title="t('navFaq')" icon="lucide-life-buoy">
      <HelpFaq>
        <HelpFaqItem v-for="n in 9" :key="n" :question="t(`q${n}` as Key)"
          ><Say :k="`a${n}q` as Key" :ui="L"
        /></HelpFaqItem>
      </HelpFaq>
    </HelpSection>

    <HelpSection id="own" :title="t('navOwn')" icon="lucide-video" :lead="t('ownLead')">
      <HelpSteps>
        <HelpStep v-for="step in ownSteps" :key="step" :title="t(`${step}Title`)"><Say :k="step" :ui="L" /></HelpStep>
      </HelpSteps>
      <h3>{{ t('fitTitle') }}</h3>
      <p>{{ t('fit') }}</p>
      <h3>{{ t('convertTitle') }}</h3>
      <p><Say k="convert1" :ui="L" /></p>
      <p><Say k="convert2" :ui="L" /></p>
      <HelpCallout type="warning" :title="t('warnTitle')">{{ t('convertWarn') }}</HelpCallout>
      <h3>{{ t('resetTitle') }}</h3>
      <p><Say k="reset" :ui="L" /></p>
      <h3>{{ t('appsTitle') }}</h3>
      <p><Say k="apps" :ui="L" /></p>
      <p>{{ t('ownStorage') }}</p>
    </HelpSection>
  </HelpLayout>
</template>

<script setup lang="ts">
/**
 * The Demo Factory Studio's user guide — the app's helpScreen
 * (DemoFactoryHelpScreen), opened from the user menu's Help entry.
 *
 * Built from the framework's Help kit. Every text is a message under
 * b1App.DemoFactoryHelp with the English below as its fallback; the German
 * is in public/i18n/de.json. On-screen labels are not repeated here: they
 * are read through the blueprint's own translation keys (L), so the guide
 * names a button exactly as the translated UI shows it. In a message, such a
 * label is a {placeholder} that Say renders as HelpUi.
 */
import { launchScreen, type NativeComponent, translate } from '@buildone/web-core';
import { getUserMenuTerms } from '@buildone/web-framework-layer/src/components/help/helpKit';
import HelpUi from '@buildone/web-framework-layer/src/components/help/HelpUi.vue';
import Button from 'primevue/button';
import { computed, h, type FunctionalComponent } from 'vue';

import type { HelpFlowNode, HelpNavSection, HelpTerm } from '@buildone/web-framework-layer/src/components/help/helpKit';

defineProps<{ instance: NativeComponent }>();

const EN = {
  title: 'From a first draft to a finished video',
  eyebrow: 'Demo Factory · User guide',
  subtitle:
    'You describe what should be shown and said. The Factory speaks the text, operates the app and cuts a video from it. This guide walks you through the steps and explains the most important buttons.',
  startHere: 'Open the overview',
  navHow: 'How it works',
  navSetup: 'Set up once',
  navFirst: 'My first video',
  navButtons: 'Screens and buttons',
  navScenes: 'Scenes and clicks',
  navAgent: 'Editing with the agent',
  navVoice: 'Voice, captions and timing',
  navResults: 'Results and storage',
  navFaq: 'When something goes wrong',
  navOwn: 'From your own screen recording',
  howLead: 'A demo is the blueprint of your video: settings and an ordered list of scenes.',
  howScenes:
    'Each scene has a start page, a spoken text and actions such as clicks or text input. Four steps turn the blueprint into a video:',
  flowLabel: 'How a video is made',
  flowValidate: 'Validate',
  flowValidateNote: 'Is the blueprint complete and valid?',
  flowVoice: 'Voice-over',
  flowVoiceNote: 'Speak the text and time its words',
  flowRecord: 'Record',
  flowRecordNote: 'Open the app in a browser and perform the actions',
  flowRender: 'Render',
  flowRenderNote: 'Recordings, voice and captions become the MP4',
  howRunAll:
    '{runAll} performs these steps in one go, including preparing the sign-in. A run is one pass: a demo can have many runs, such as a first attempt and an improved version.',
  howVideo:
    'You do not have to describe every scene yourself: the Demo Creator agent can write them for you, or you record the app yourself and upload the recording — see “Ways to create a demo”.',
  howNote:
    'You edit the blueprint; the Factory cuts the video from it. Changing a demo does not change an MP4 that was already rendered.',
  screensTitle: 'The Studio’s screens',
  cardHome: 'Every demo as a film strip, the key figures and the buttons to start a new one.',
  cardDemos: 'The list of demos: open one to edit its scenes, voice-over and runs.',
  cardRuns: 'The runs of all demos, with their videos and captions.',
  cardSettings: 'Runtime configuration, the demo users recordings sign in as, and what this host can run.',
  navWays: 'Ways to create a demo',
  waysLead:
    'There are four ways to a new demo. Each ends in an ordinary demo: scenes you can refine, voice and record again.',
  waysAgent:
    'The default. Say in a sentence what the video should show, or name a Linear ticket. The Demo Creator writes the scenes, tries each one live in the target app as the demo user, and then records and renders the video.',
  waysNew:
    'By hand, from the blank starter or as a copy of the selected demo. You write the scenes, narration and actions yourself — see “My first video”.',
  waysVideo:
    'From your own screen recording: operate the app, speak, upload. The Factory cuts it into scenes and voices your words anew — see “From your own screen recording”.',
  waysImport: 'From a demo.yaml, for example one exported from another environment.',
  waysWhichTitle: 'Which way when?',
  waysWhichAgent: 'You know what the video should show, but not every click — or there is a ticket for the feature.',
  waysWhichNew: 'You want full control over every action, or you want to vary an existing demo.',
  waysWhichVideo:
    'Showing it is quicker than describing it. Later, {convert} turns the clips into scenes the Factory films itself.',
  waysWhichImport: 'The demo already exists elsewhere, or you restore a backup.',
  waysWhere:
    'All four buttons are in the welcome panel of the {overview}; the toolbar in {demos} has them too, where the agent button is called {askAgent}.',
  waysAfter:
    'Whichever way you start: afterwards you can refine the demo with the agent ({editWithAgent}), edit it by hand and record it again.',
  setupLead:
    'Open {settings} in the menu on the left. It shows the running Factory’s configuration and the steps this host can perform.',
  setupAppTitle: 'Reach the right app',
  setupApp:
    'B1_BASE_URL is the address of the app to record. Use the right environment and, if needed, the app selection, for example https://my-environment.example/?app=b1-labs. The recording browser must be able to reach this address.',
  setupUserTitle: 'Set up the demo user',
  setupUser:
    'A recording does not sign in to the target app with your account but as a demo user — usually an account of its own with demo data. Sign in to the target app once as that user and create an API key under Account → API keys. Enter it in {settings} under {demoUsers}: id (e.g. samples-demo), name, the app it is meant for, and the key. Then click {saveDemoUser}.',
  setupKey:
    'The key goes to the organization’s secret store and is never shown again; {keyStored} tells whether it is there. To replace it, enter a new one; left empty, the stored key stays. Only owners and admins of the organization may save it.',
  setupSignIn: 'In the demo, pick the demo user under {signInAs}. Left empty, the Factory uses this server’s API key.',
  setupVoiceTitle: 'Set up the voice',
  setupVoice:
    'Spoken videos need an ElevenLabs API key and a voice id on the server, usually ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID. If they are missing, ask whoever runs the environment. For a first test, use the provider silent: the video then has no voice.',
  setupHost:
    '{settings} also shows which steps this host can run. If recording or rendering is not available, the environment has to be set up for it.',
  firstLead:
    'This chapter walks through the manual way, to show what a demo consists of. With {agent}, the agent does most of these steps for you. Start with a short video: open an app, show one feature, done. One or two scenes are enough for a first attempt.',
  s1Title: 'Create a demo',
  s1: 'On the {overview} or in {demos}, click {newDemo}. Choose a unique id such as my-first-video and a title. The id may contain lowercase letters, digits and hyphens. {startFrom} tells whether the selected demo is copied or the blank starter is used — a fitting existing demo is often the fastest start. Click {createDemo}; the new demo opens.',
  s2Title: 'Check the recording settings',
  s2: 'On the {demoTab} tab, check the target address. The base URL fallback is used when the named environment variable has no value; if B1_BASE_URL is set, it wins. 1920 × 1080 as viewport and 30 frames per second are a good start. The viewport is the size of the recorded browser window. Click {save}.',
  s3Title: 'Describe the first scene',
  s3: 'Open {scenesTab}. Open a scene by its title or add one with {addScene}. Give it a clear title, a start route and a short narration, for example: “Here are our customers on the map. A click on the group shows the single addresses.” A route such as /screens/MyMap?app=my-app names the page inside the target app — use a page that really exists. Save the scene in its window.',
  s4Title: 'Add the actions',
  s4: 'The scene window’s {actionsTab} tab holds the actions and checks as JSON. If you would rather not write them yourself, save and close the scene, select its row and click {editWithAgent} at the top — for example: “Show the customer map in this scene. Click the group with 12 addresses so the map zooms in. Time the click to the narration.” Check the agent’s proposal before recording.',
  s5Title: 'Choose the voice',
  s5: 'On the {voiceTab} tab, choose elevenlabs for a voice or silent for a mute test. Set the model, for example eleven_v4 if your ElevenLabs plan supports it. For German text the language code is de. Save.',
  s6Title: 'Validate the blueprint',
  s6: 'On the {demoTab} tab, click {validate} and fix what it reports, such as a missing route or a misspelled cue. It checks the blueprint; whether a button really exists in the target app only the recording shows.',
  s7Title: 'Make the whole video',
  s7: 'Click {runAll} at the top. The Factory saves open demo settings and starts the run. The status bar shows the progress, the {logTab} tab the details, and {cancelJob} stops the job. Recording and especially rendering take a while. The Factory really performs the actions in the target app — use suitable demo data.',
  s8Title: 'Watch the result',
  s8: 'Open the {runsTab} tab, select the finished run and click {openVideo}. Check picture, voice, clicks and captions; {openCaptions} opens the separate caption file. On the {overview}, the demo’s film strip now shows a frame per scene and plays the video. To change something, adapt the demo and start a new full run.',
  overviewTitle: 'The overview',
  overview1:
    'The Studio opens on the {overview}: a greeting with the key figures and the buttons {agent}, {newDemo}, {import} and {importVideo}, and below it the {listOfDemos} — every demo as a film strip with one frame per scene.',
  overview2:
    'The frames come from the newest rendered run, for a video demo without one from the uploaded recording; a demo that was never filmed shows blank frames. Play shows the video in a window, Open or a click on the title opens the demo. The search in the list’s header finds titles, ids and descriptions; the filter My demos shows only the demos you created.',
  overview3:
    'Whoever creates, imports or makes a demo from a video becomes its owner; demos from the repository’s files have none.',
  buttonsTitle: 'The buttons of a demo',
  buttonsLead: 'The buttons at the top apply to the whole demo; those in the tabs belong to their step.',
  bSave: 'Save changes to the demo settings.',
  bRunAll: 'Make the complete video: voice-over, recording and rendering.',
  bAgent: 'Open a chat about this demo and the selected scene.',
  bClose: 'Close the demo window.',
  bValidate: 'Check the blueprint for valid entries (Demo tab).',
  bMore: 'Export the blueprint or delete the demo; deleting asks first.',
  bVoice: 'Prepare voice and timings (Voice-over tab); makes no finished video yet.',
  bScenes: 'Add a scene, copy the selected one or delete it (Scenes tab).',
  bRecordOne: 'Record only the selected scene again — for targeted fixes after a successful full recording.',
  bRecordAll: 'Record all scenes; the voice-over must be prepared first.',
  bRender: 'Render the selected recorded run into an MP4, with the settings stored in that run (Runs tab).',
  bOpen: 'Open the finished MP4 or the SRT captions.',
  bCancel: 'Stop the running pipeline job.',
  menuTitle: 'The user menu',
  menuLead: 'The avatar at the top right opens the user menu. This guide is its {help} entry.',
  scenesLead:
    'Every scene starts with a fresh browser. It opens its own page and prepares everything it needs; it must not rely on a previous scene having opened a tab.',
  cueTitle: 'Narration and cues',
  cue: 'A cue is a mark in the narration, for example [cue:map]. It is not spoken. An action with atCue: "map" happens at that point: “Here is the customer map. [cue:map] Now we open the map view.”',
  jsonTitle: 'An action as JSON',
  json: 'Actions are a list in square brackets. This example clicks, at the cue, a button whose visible name is “Map”; name and role must match the real app.',
  target:
    'target describes the element: role and name a button and its label, text visible text, css a technical selector. Map markers often need a selector — “12” alone can match several elements. Let the agent look at the real page.',
  verbs:
    'click clicks, fill sets a field value, type types it, press presses a key, highlight sets an element off, waitFor waits until an element is visible. timelapse shortens long waits in the finished video.',
  calloutTitle: 'Text banners in the picture',
  callout:
    'A callout action shows a text at the bottom of the picture; value holds the text, as in the example below. The banner stays until the next banner or the end of the scene; durationMs limits it, an empty value removes it. After changing the text, record and render the scene again.',
  assertTitle: 'Assertions: what must be visible?',
  assert:
    'Assertions are checks after the actions. This one requires the text “Customer map” to be visible. Without actions or checks the field holds []. Invalid JSON is marked as an error and does not replace the stored data — fix it before saving.',
  agentLead: 'The Demo Agent edits a demo in a chat — scenes, narration, actions.',
  a1: 'Open the demo.',
  a2: 'Under {scenesTab}, select the scene your request is about. Save and close a scene window before the chat.',
  a3: 'Click {editWithAgent} in the toolbar at the top.',
  a4: 'Write in the chat what should change.',
  agentContext:
    'The chat receives the demo’s id and title and, if one is selected, the scene’s id, title and position. The context is fixed when the chat opens: selecting another scene later does not change an open chat — name the new scene id or open a new chat. Without a selected scene the agent asks what “here” means.',
  agentEx1: '“After this scene, add one that shows how I create a new customer. Use a short narration.”',
  agentEx2: '“Shorten this scene’s narration to about 20 seconds, but keep the cue marks for the clicks.”',
  agentCheck: 'Check the agent’s changes in the Studio afterwards, then record again — at first best with {runAll}.',
  featureTitle: 'A video of a new feature',
  feature:
    'The Demo Creator can design a video of a newly built feature on its own. On the {overview}, click {agent} (in {demos}: {askAgent}) and name the Linear ticket, the target app and the demo user: “Make a product video of the new feature from B1-1658. Record in https://samples.demo.build.one/ as the demo user samples-demo, English voice.”',
  f1: 'It reads the ticket — problem, acceptance criteria, linked pull requests — and the pull request’s description and changed files.',
  f2: 'It checks whether the feature has shipped in the target app and outlines the planned scenes.',
  f3: 'It opens every start page live as the demo user, reads the real labels and tries each scene before saving it.',
  f4: 'Then it validates, voices, records and renders the video.',
  featureNote:
    'Reading the ticket needs a Linear key on your account (Secrets → Linear API Key); without one the agent asks for the ticket text. The trial runs act in the target app as the demo user: what a scene saves or sends really happens there.',
  voiceProvider:
    'The provider decides whether there is speech: elevenlabs speaks, silent stays mute, auto uses ElevenLabs when key and voice are there.',
  voiceModel:
    'The v4 model is called eleven_v4 (eleven_multilingual_v4 does not exist); eleven_multilingual_v2 still works. A server variable ELEVENLABS_MODEL_ID overrides the model field. Voice and model must be available in your ElevenLabs plan.',
  voiceCache:
    'Long texts are spoken in pieces and joined. Unchanged texts and voice settings come from the cache, which saves generating them again.',
  voiceTiming:
    'When the narration or the voice changes, the action timings can change. Generate the voice-over again, then record and render — or start the full run.',
  voiceLook:
    '{cursor} shows the demo mouse pointer; {burnCaptions} makes captions part of the picture — a separate SRT file is made either way. 30 fps is a good default for app demos; 60 fps renders more frames and takes longer.',
  res1: 'Back up the blueprint with {moreActions} → {export} as demo.yaml and import it later with {import}. The file describes the video; it is not a video.',
  res2: 'Every run has a folder of its own, named by its run id, holding the MP4, the SRT captions and the run’s details after rendering. The easiest way to the result is the run in the app.',
  res3: 'DEMO_OUTPUT_DIR sets the output folder, DEMO_CACHE_DIR the speech cache. Unconfigured, output goes to the Factory’s output folder — in a workspace under /workspace/src/app-server-ts/demo-factory/output. The standalone deployment uses /data/demo-factory/output and /data/demo-factory/cache on a persistent volume. Changing the location does not move existing results.',
  q1: 'The agent chat says “404 page not found”',
  a1q: 'The agent server’s address, the server variable B1_AGENT_SERVER_URL, may be wrong. The current default is https://adorable.test.build.one; the old https://try-adorable.test.build.one is gone. Have the runtime configuration fixed and the app server restarted. The address your video records is not affected.',
  q2: 'The log shows the sign-in page',
  a2q: 'Check the target address and the demo user. A session for another domain does not help. A wrong API key can make the Factory fall back on an old stored state.',
  q3: '“Model not found” from ElevenLabs',
  a3q: 'Check the model name — for v4 it is eleven_v4 — whether a server variable overrides the field, and whether your plan includes the model.',
  q4: 'A click runs into a timeout',
  a4q: 'The Factory does not find the element in time. Open the page yourself: is the right app loaded, are you signed in, is the button’s text right, does another tab have to open or data load first? The log names the element it looked for and, for a failed recording, the path of a screenshot.',
  q5: 'The JSON is not formatted, or saving fails',
  a5q: 'Actions and assertions must be lists, such as [] or the examples above. Check quotes, commas and brackets. A missing title, an invalid route or an unknown cue can also stop the save.',
  q6: 'No finished video despite a voice-over',
  a6q: 'The voice-over is only the first step; recording and rendering follow. Render a successfully recorded run or start {runAll}.',
  q7: 'Analyzing the uploaded video fails',
  a7q: '“No ffmpeg” means ffmpeg is missing on the server; in a Codespace, yarn demo:provision restores it after a restart. If ElevenLabs speech-to-text reports an error, check key and quota. Without a key the video is still cut into scenes, only the narrations stay empty.',
  q8: '“The source video … is not on this host”',
  a8q: 'The scenes of a video demo are clips of the uploaded file. A demo moved to another environment as demo.yaml lacks the file there; upload the recording there again with {importVideo}.',
  q9: 'Rendering takes long or stops',
  a9q: 'Rendering is the heaviest step. The {logTab} tab shows progress and errors. A memory or browser error needs the server configuration checked. For a report, note demo id, run id and the last error.',
  ownLead:
    'Instead of describing clicks as actions, operate the app yourself and record it — with OBS, QuickTime, Loom or your operating system’s recorder — and say aloud what you show. The Factory cuts the recording into scenes and makes your words their narration.',
  o1Title: 'Record',
  o1: 'Record only the browser window, ideally at 1920 × 1080. Speak in whole sentences and pause briefly before moving to the next page or step — that is where the scene boundaries fall. Slips and “uhm” do not matter: filler words are removed and you can correct the text afterwards.',
  o2Title: 'Upload',
  o2: 'Click {importVideo} on the {overview} or in {demos} and choose the file (MP4, MOV, WebM or MKV, up to 4 GB); the upload starts at once. Id and title are prefilled from the file name — adapt them. Under spoken language, auto detects the language.',
  o3Title: 'Have it analyzed',
  o3: 'Click {analyze}. The Factory finds where the picture changes clearly (a new page, a dialog), transcribes your speech with timestamps and cuts where you pause and the picture changes — scenes of about 15 to 45 seconds, never in the middle of a word. The new demo appears in the list shortly after.',
  o4Title: 'Check the scenes',
  o4: 'Open the demo. Instead of a route each scene has a clip — the part of your recording in milliseconds (startMs, endMs) and voiceAtMs, where you start speaking. The narration is what you said: correct it, shorten it or rewrite it, and give the scenes better titles. Scenes can be deleted, duplicated and reordered as usual, or in the chat with the agent.',
  o5Title: 'Make the video',
  o5: 'Click {runAll}. The narration is voiced again with the configured voice, every clip is cut from your recording and fitted to the new voice, and everything is rendered into the finished video with titles and captions. No sign-in or recording browser is needed.',
  fitTitle: 'How picture and new voice fit',
  fit: 'If the new voice is faster or slower than you, the clip plays faster (at most 2.5×) or slower (at least 0.8×); if that is not enough, the last frame holds at the end. Long silent stretches at the start of a scene — a loading page — play as a timelapse with a ▶▶ mark, and the voice starts exactly where you started speaking.',
  convertTitle: 'Convert to filmed scenes',
  convert1:
    '{convert} (in the pipeline bar at the top) turns the clips of your recording into a demo that operates the app itself, like one written by hand or by the agent. For each scene, Claude looks at stills of your recording, your text and the running app and writes the clicks and inputs with their cues. A trial run with Playwright checks them; if it fails, Claude corrects the proposal up to twice.',
  convert2:
    'Scenes whose trial run works are set to footage film and filmed again at the next {runAll} — sharp, with an animated pointer, and repeatable. Your clip stays: footage clip brings it back. Scenes that fail stay clips; {conversionSays} tells why, and the proposed actions stay in the scene as a draft.',
  convertWarn:
    'Trial runs really act in the app, as the signed-in demo user: what a scene sends or saves is sent at every trial run and recording. Convert only against a demo environment, never against production data.',
  warnTitle: 'Careful',
  resetTitle: 'Reset before recording',
  reset:
    'With {resetRepository} on the {demoTab} tab, the Factory resets the target app’s blueprints before every recording and conversion, like the Reset repository button of the Changes screen. Every blueprint change of that environment is lost and the recording starts from the shipped state — for everyone using the environment, and only for the app of the base URL. If the reset fails, nothing is recorded.',
  appsTitle: 'Scenes in different apps',
  apps: 'Each scene can name an app of its own under {appUrl}, for example first https://samples.demo.build.one/ to create a change request and then https://platform.demo.build.one/ to show it there. The scene’s route then applies in that app; empty means the demo’s base URL. Before recording, the Factory signs in to each of these apps. New demos point to https://samples.demo.build.one/.',
  ownStorage:
    'The uploaded file lies on the server next to the runs. Deleting the demo deletes the recording too. An exported demo.yaml does not contain it.',
  uiLog: 'Log',
  uiAddDupDelete: 'Add / Duplicate / Delete scene',
  uiOpenVideoCaptions: 'Open video / Open captions',
  uiAppUrl: 'Application URL'
} as const;

type Key = keyof typeof EN;

const t = (key: Key, params?: Record<string, unknown>): string =>
  translate(`b1App.DemoFactoryHelp.${key}`, EN[key], params);

/** A label as the translated UI shows it: the blueprint object's own translation key. */
const ui = (key: string, fallback: string): string => translate(key, fallback);

const L = computed(() => ({
  overview: ui('DemoFactoryMenu.Overview._label', 'Overview'),
  demos: ui('DemoFactoryMenu.Demos._label', 'Demos'),
  runs: ui('DemoFactoryMenu.Runs._label', 'Runs'),
  settings: ui('DemoFactoryMenu.Settings._label', 'Settings'),
  listOfDemos: ui('DemoFactoryHomeScreen.reelPanel._title', 'List of demos'),
  agent: ui('b1App.DemoFactoryWelcome.agent', 'Create with agent'),
  newDemo: ui('DemoFactoryDemoSearchToolbar.newDemo._label', 'New demo'),
  import: ui('DemoFactoryDemoSearchToolbar.importDemo._label', 'Import'),
  importVideo: ui('DemoFactoryDemoSearchToolbar.importVideo._label', 'Import video'),
  askAgent: ui('DemoFactoryDemoSearchToolbar.askAgent._label', 'Ask the Demo Creator'),
  startFrom: ui('DemoFactoryDemoCreate.startFrom._label', 'Start from'),
  createDemo: ui('DemoFactoryDemoCreate.createButton._label', 'Create demo'),
  save: ui('DemoFactoryDemoMaintenanceToolbar.saveAction._label', 'Save'),
  runAll: ui('DemoFactoryDemoMaintenanceToolbar.runAll._label', 'Run full demo'),
  editWithAgent: ui('DemoFactoryDemoMaintenanceToolbar.editWithAgent._label', 'Edit with Demo Agent'),
  close: ui('DemoFactoryDemoMaintenanceToolbar.closeAction._label', 'Close'),
  demoTab: ui('DemoFactoryDemoMaintenance.demoTab._label', 'Demo'),
  voiceTab: ui('DemoFactoryDemoMaintenance.voiceoverTab._label', 'Voice-over'),
  scenesTab: ui('DemoFactoryDemoMaintenance.scenesTab._label', 'Scenes'),
  runsTab: ui('DemoFactoryDemoMaintenance.runsTab._label', 'Runs'),
  logTab: ui('DemoFactoryDemoMaintenance.logTab._label', 'Log'),
  signInAs: ui('DemoFactoryDemoMaintenance.settings.demoUser._label', 'Sign in as'),
  cursor: ui('DemoFactoryDemoMaintenance.settings.cursor.enabled._label', 'Show the cursor overlay'),
  burnCaptions: ui('DemoFactoryDemoMaintenance.settings.branding.showCaptions._label', 'Burn captions into the video'),
  resetRepository: ui(
    'DemoFactoryDemoMaintenance.settings.resetRepository._label',
    'Reset repository before recording'
  ),
  validate: ui('DemoFactoryDemoActionsToolbar.validate._label', 'Validate'),
  moreActions: ui('DemoFactoryDemoActionsToolbar.DemoFactoryMoreActions._label', 'More actions'),
  export: ui('DemoFactoryDemoActionsToolbar.exportAction._label', 'Export'),
  convert: ui('DemoFactoryDemoActionsToolbar.convertVideo._label', 'Convert to filmed scenes'),
  cancelJob: ui('DemoFactoryPipelineToolbar.cancel._label', 'Cancel job'),
  generateVoice: ui('DemoFactoryVoiceoverToolbar.prepare._label', 'Generate voiceover'),
  addScene: ui('DemoFactoryScenesToolbar.addScene._label', 'Add scene'),
  recordOne: ui('DemoFactoryScenesToolbar.record._label', 'Record selected scene'),
  recordAll: ui('DemoFactoryScenesToolbar.recordAll._label', 'Record all scenes'),
  renderRun: ui('DemoFactoryRunsToolbar.render._label', 'Render selected run'),
  openVideo: ui('DemoFactoryRunsToolbar.openVideo._label', 'Open video'),
  openCaptions: ui('DemoFactoryRunsToolbar.openCaptions._label', 'Open captions'),
  actionsTab: ui('DemoFactorySceneMaintenance.actionsTab._label', 'Actions'),
  conversionSays: ui(
    'DemoFactorySceneMaintenance.conversion.message._label',
    'What the conversion says about this scene'
  ),
  appUrl: t('uiAppUrl'),
  demoUsers: ui('DemoFactorySettingsScreen.DemoFactoryDemoUsersGrid._title', 'Demo users'),
  saveDemoUser: ui('DemoFactorySettingsScreen.saveDemoUserButton._label', 'Save demo user'),
  keyStored: ui('DemoFactorySettingsScreen.demoUserKeyStored._label', 'Key stored'),
  analyze: ui('DemoFactoryVideoImportScreen.analyzeButton._label', 'Analyze & create demo'),
  help: ui('b1App.Help.help', 'Help')
}));

/** Marks a placeholder's place in a translated message, so Say can split it out again. */
const MARK = '\u0000';

/** A message whose {placeholders} are on-screen labels, rendered as HelpUi. */
const Say: FunctionalComponent<{ k: Key; ui: Record<string, string> }> = (props) => {
  const params = Object.fromEntries(Object.keys(props.ui).map((name) => [name, `${MARK}${name}${MARK}`]));
  return t(props.k, params)
    .split(MARK)
    .map((part, index) => (index % 2 === 1 ? h(HelpUi, () => props.ui[part] ?? part) : part));
};
Say.props = ['k', 'ui'];

const sections = computed<HelpNavSection[]>(() => [
  { id: 'how', label: t('navHow'), icon: 'lucide-workflow' },
  { id: 'ways', label: t('navWays'), icon: 'lucide-git-fork' },
  { id: 'setup', label: t('navSetup'), icon: 'lucide-wrench' },
  { id: 'first', label: t('navFirst'), icon: 'lucide-rocket' },
  { id: 'buttons', label: t('navButtons'), icon: 'lucide-mouse-pointer-click' },
  { id: 'scenes', label: t('navScenes'), icon: 'lucide-mouse-pointer-2' },
  { id: 'agent', label: t('navAgent'), icon: 'lucide-bot' },
  { id: 'voice', label: t('navVoice'), icon: 'lucide-audio-lines' },
  { id: 'results', label: t('navResults'), icon: 'lucide-folder-open' },
  { id: 'faq', label: t('navFaq'), icon: 'lucide-life-buoy' },
  { id: 'own', label: t('navOwn'), icon: 'lucide-video' }
]);

const flow = computed<HelpFlowNode[]>(() => [
  { label: t('flowValidate'), icon: 'lucide-list-checks', note: t('flowValidateNote') },
  { label: t('flowVoice'), icon: 'lucide-audio-lines', note: t('flowVoiceNote') },
  { label: t('flowRecord'), icon: 'lucide-video', note: t('flowRecordNote') },
  { label: t('flowRender'), icon: 'lucide-film', note: t('flowRenderNote') }
]);

const firstSteps = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'] as const;
const agentSteps = ['a1', 'a2', 'a3', 'a4'] as const;
const ownSteps = ['o1', 'o2', 'o3', 'o4', 'o5'] as const;

/** Which way to a demo fits when — label and icon as on the overview's buttons. */
const ways = computed<HelpTerm[]>(() => [
  { label: L.value.agent, icon: 'lucide-sparkles', text: t('waysWhichAgent') },
  { label: L.value.newDemo, icon: 'lucide-plus', text: t('waysWhichNew') },
  { label: L.value.importVideo, icon: 'lucide-file-video', text: t('waysWhichVideo', { convert: L.value.convert }) },
  { label: L.value.import, icon: 'lucide-upload', text: t('waysWhichImport') }
]);

const buttons = computed<HelpTerm[]>(() => [
  { label: L.value.save, icon: 'lucide-save', text: t('bSave') },
  { label: L.value.runAll, icon: 'lucide-play', text: t('bRunAll') },
  { label: L.value.editWithAgent, icon: 'lucide-bot', text: t('bAgent') },
  { label: L.value.close, icon: 'lucide-x', text: t('bClose') },
  { label: L.value.validate, icon: 'lucide-list-checks', text: t('bValidate') },
  { label: L.value.moreActions, icon: 'lucide-ellipsis', text: t('bMore') },
  { label: L.value.generateVoice, icon: 'lucide-audio-lines', text: t('bVoice') },
  { label: t('uiAddDupDelete'), icon: 'lucide-list-plus', text: t('bScenes') },
  { label: L.value.recordOne, icon: 'lucide-circle-dot', text: t('bRecordOne') },
  { label: L.value.recordAll, icon: 'lucide-video', text: t('bRecordAll') },
  { label: L.value.renderRun, icon: 'lucide-film', text: t('bRender') },
  { label: t('uiOpenVideoCaptions'), icon: 'lucide-external-link', text: t('bOpen') },
  { label: L.value.cancelJob, icon: 'lucide-circle-stop', text: t('bCancel') }
]);

const userMenuTerms = computed(() => getUserMenuTerms());

const actionExample = `[
  {
    "action": "click",
    "atCue": "map",
    "target": { "role": "button", "name": "Map" }
  }
]`;

const calloutExample = '{ "action": "callout", "atCue": "rights", "value": "Your account. Your permissions." }';

const assertionExample = `[
  { "visible": { "text": "Customer map" } }
]`;

const openOverview = () => launchScreen('DemoFactoryHomeScreen');
</script>

<style scoped>
.demo-factory-help__code {
  margin: 0.75rem 0;
  padding: 0.75rem 1rem;
  overflow-x: auto;
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  background: var(--p-content-hover-background);
  font-size: 0.85em;
  line-height: 1.5;
}

.demo-factory-help__quote {
  margin: 0.75rem 0;
  padding: 0.5rem 1rem;
  border-left: 3px solid var(--p-primary-color);
  color: var(--p-text-muted-color);
  font-style: italic;
}
</style>
