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
    const result = (await invokeServerTask({
      name: 'agent-proxy',
      methodName: 'agent-server-proxy-actions/create-conversation',
      methodType: 'coreServerAction',
      paramObj: {
        environmentUrl: window.location.origin,
        agentObjectMasterGuid: DEMO_CREATOR_AGENT_GUID,
        prompt,
        ...(payload.demoId
          ? { systemPromptSuffix: `The user has the demo "${payload.demoId}" open in the Demo Factory Studio.` }
          : {})
      }
    })) as Record<string, unknown>;
    const conversationId = String(result?.conversationId ?? result?.conversation_id ?? result?.id ?? '').replaceAll(
      '-',
      ''
    );
    if (!conversationId) throw new Error('The conversation was created but its id was not returned');
    closeScreen(screen);
    await launchScreen('agentChatScreen', { repositionTo: conversationId, data: { conversationId } });
  } catch (error) {
    displayError(errorMessage(error));
  }
}
