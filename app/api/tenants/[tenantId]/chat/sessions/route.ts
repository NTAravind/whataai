import { NextRequest } from "next/server";
import { requireTenantAccess } from "@/lib/auth/guard";
import { listChatSessions, getChatHistory } from "@/lib/services/chat-sessions";
import { NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  const user = await requireTenantAccess(tenantId);
  const searchParams = req.nextUrl.searchParams;
  const sessionId = searchParams.get("sessionId");

  if (sessionId) {
    const history = await getChatHistory(sessionId);
    return NextResponse.json({ history });
  } else {
    const sessions = await listChatSessions(tenantId, user.id);
    return NextResponse.json({ sessions });
  }
}
