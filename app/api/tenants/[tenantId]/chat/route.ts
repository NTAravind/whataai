import { NextRequest } from "next/server";
import { requireTenantAccess } from "@/lib/auth/guard";
import { ModelMessage } from "ai";
import { streamTenantAgent } from "@/lib/agents/tenant-runtime";
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
  const user = await requireTenantAccess(tenantId);

  const { messages, sessionId: providedSessionId } = await req.json();

  let sessionId = providedSessionId as string | undefined;
  let history: ModelMessage[] = [];

  if (!sessionId) {
    const newSession = await createChatSession(tenantId, user.id);
    sessionId = newSession.id;

    const firstMsg = (messages as ModelMessage[]).find((m) => m.role === "user");
    const firstText =
      firstMsg && typeof firstMsg.content === "string" ? firstMsg.content : null;
    if (firstText) await autoTitleSession(sessionId, firstText);
  } else {
    history = await getChatHistory(sessionId);
  }

  const newMessages = (messages as ModelMessage[]).slice(history.length);
  await appendChatMessages(sessionId, newMessages as { role: string; content: unknown }[]);

  const result = await streamTenantAgent({
    tenantId,
    messages: newMessages,
    history,
    onFinish: async (event) => {
      if (event?.response?.messages?.length) {
        await appendChatMessages(
          sessionId!,
          event.response.messages as { role: string; content: unknown }[]
        );
      }
    },
  });

  return result.toTextStreamResponse({
    headers: { "x-session-id": sessionId },
  });
}
