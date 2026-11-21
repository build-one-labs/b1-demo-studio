/**
 * Client logic of the "Ask the Demo Creator" dialog.
 *
 * Starts a conversation with the Demo Creator agent against this environment
 * and opens it. The proxy resolves the agent's model, prompt, skills and MCP
 * servers from its objectMasterGuid; `environmentUrl` makes the conversation
 * connect to the environment this screen runs in. The open demo travels as
 * trailing system-prompt context so "this demo" means something on the other
 * side.
 */
import {
  closeScreen,
  conversationScreenPayload,
  DEFAULT_CONVERSATION_SCREEN,
  displayError,
  displayWarning,
  invokeServerTask,
  launchScreen,
  type ObjectInstance
} from '@buildone/web-core';

import { DEMO_CREATOR_AGENT_GUID, errorMessage, formOf, screenOfObject } from '../shared/demoFactoryStudio';

interface AgentPayload {
  demoId?: string;
  demoTitle?: string;
  sceneId?: string;
  sceneTitle?: string;
  sceneSequence?: number;
}

interface CreatedConversation {
  conversationId: string;
  /** The agent's own chat screen (b1_agent.chatScreen), when it names one. */
  chatScreen?: string;
}

/** Create a chat with explicit record context; the agent reads the saved definition through its tools. */
export async function createDemoConversation(prompt: string, payload: AgentPayload): Promise<CreatedConversation> {
  const result = (await invokeServerTask({
    name: 'agent-proxy',
    methodName: 'agent-server-proxy-actions/create-conversation',
    methodType: 'coreServerAction',
    paramObj: {
      environmentUrl: window.location.origin,
      agentObjectMasterGuid: DEMO_CREATOR_AGENT_GUID,
      prompt,
      ...(payload.demoId
        ? {
            systemPromptSuffix: `Demo Factory Studio editing context: ${JSON.stringify(payload)}. Read this demo's current definition before editing. "This demo" refers to demoId; "this scene", "after this scene" and "here" refer to sceneId when supplied. If no sceneId is supplied, ask which scene the user means before making scene-specific changes.`
          }
        : {})
    }
  })) as { request?: { conversation_id?: string }; conversation_id?: string; id?: string; chatScreen?: string };
  // The proxy mints the id and returns it as `request.conversation_id` (the
  // conversation itself comes up in the background; the chat waits for it).
  const conversationId = String(result?.request?.conversation_id ?? result?.conversation_id ?? result?.id ?? '');
  if (!conversationId) throw new Error('The conversation was created but its id was not returned');
  return { conversationId, chatScreen: result?.chatScreen };
}

/**
 * Open the chat of a just-created conversation: the agent's own screen, with
 * the payload the framework's start flow uses — the prompt travels along so the
 * chat shows it while the sandbox boots.
 */
export async function openDemoConversation(
  { conversationId, chatScreen }: CreatedConversation,
  prompt: string
): Promise<void> {
  await launchScreen(
    chatScreen?.trim() || DEFAULT_CONVERSATION_SCREEN,
    conversationScreenPayload(conversationId, prompt)
  );
}

export async function startConversation(eventSource: ObjectInstance): Promise<void> {
  const form = formOf(eventSource, 'DemoFactoryAgentForm');
  const screen = screenOfObject(form);
  if (!screen || !form) {
    displayError('The agent form was not found.');
    return;
  }
  const prompt = String(form.getValue('prompt') ?? '').trim();
  if (!prompt) {
    displayWarning('Say what the Demo Creator should do.');
    return;
  }
  const payload = (screen.payload?.data ?? eventSource.screen?.payload?.data ?? {}) as AgentPayload;
  try {
    const created = await createDemoConversation(prompt, payload);
    closeScreen(screen);
    await openDemoConversation(created, prompt);
  } catch (error) {
    displayError(errorMessage(error));
  }
}
