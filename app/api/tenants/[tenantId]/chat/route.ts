import { NextRequest } from "next/server";
import { requireTenantAccess } from "@/lib/auth/guard";
import { ModelMessage, UIMessage, convertToModelMessages } from "ai";
import { createAgentUIStreamResponse } from "ai";
import { buildTenantAgent } from "@/lib/agents/tenant-runtime";
import {
  createChatSession,
  getChatHistory,
  appendChatMessages,
  autoTitleSession,
} from "@/lib/services/chat-sessions";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  console.log(`[chat] POST request for tenant ${tenantId}`);

  let user;
  try {
    user = await requireTenantAccess(tenantId);
  } catch (err) {
    console.error(`[chat] Auth failed for tenant ${tenantId}:`, err);
    return new Response("Unauthorized", { status: 401 });
  }

  let body: { messages?: unknown; sessionId?: unknown; model?: unknown };
  try {
    body = await req.json();
  } catch (err) {
    console.error(`[chat] Failed to parse request body:`, err);
    return new Response("Invalid JSON body", { status: 400 });
  }

  const { messages: rawMessages, sessionId: providedSessionId, model } = body;
  console.log(`[chat] Request: sessionId=${providedSessionId ?? "new"}, model=${model ?? "default"}, messageCount=${Array.isArray(rawMessages) ? rawMessages.length : 0}`);

  // Client sends UIMessage[] (AI SDK v7 format with `parts`).
  // Convert to ModelMessage[] (with `content`) for persistence.
  const uiMessages = rawMessages as UIMessage[];
  let incomingModelMessages: ModelMessage[];
  try {
    incomingModelMessages = await convertToModelMessages(uiMessages);
  } catch (err) {
    console.error(`[chat] convertToModelMessages failed:`, err);
    return new Response("Failed to convert messages", { status: 400 });
  }

  let sessionId = providedSessionId as string | undefined;
  let history: ModelMessage[] = [];

  if (!sessionId) {
    console.log(`[chat] Creating new session for tenant ${tenantId}`);
    const newSession = await createChatSession(tenantId, user.id);
    sessionId = newSession.id;
    console.log(`[chat] Created session ${sessionId}`);

    const firstMsg = incomingModelMessages.find((m) => m.role === "user");
    const firstText =
      firstMsg && typeof firstMsg.content === "string" ? firstMsg.content : null;
    if (firstText) await autoTitleSession(sessionId, firstText);
  } else {
    console.log(`[chat] Loading history for session ${sessionId}`);
    history = await getChatHistory(sessionId);
    console.log(`[chat] Loaded ${history.length} history messages`);
  }

  // Only persist the user messages that aren't already stored, so we don't
  // duplicate history across requests.
  const newMessageCount = incomingModelMessages.length - history.length;
  const newMessages = incomingModelMessages.slice(Math.max(0, newMessageCount));
  console.log(`[chat] New messages to persist: ${newMessages.length}`);
  await appendChatMessages(sessionId, newMessages as { role: string; content: unknown }[]);

  console.log(`[chat] Building tenant agent`);
  const agent = await buildTenantAgent({
    tenantId,
    model: typeof model === "string" ? model : undefined,
  });

  try {
    console.log(`[chat] Creating agent UI stream response for session ${sessionId}`);
    const response = await createAgentUIStreamResponse({
      agent,
      uiMessages,
      onStepEnd: async (event) => {
        try {
          const text = event.text;
          console.log(`[chat] Step ${event.stepNumber} ended, text length: ${text?.length ?? 0}, toolCalls: ${event.toolCalls?.length ?? 0}`);
          if (text) {
            await appendChatMessages(sessionId!, [{ role: "assistant", content: text }]);
          }
        } catch (err) {
          console.error(`[chat] Failed to persist assistant response:`, err);
        }
      },
      headers: { "x-session-id": sessionId },
    });
    console.log(`[chat] Agent stream response created`);
    return response;
  } catch (err) {
    console.error(`[chat] createAgentUIStreamResponse threw error:`, err);
    return new Response("Internal server error during streaming", { status: 500 });
  }
}
