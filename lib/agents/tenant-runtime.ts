import { ToolLoopAgent } from "ai";
import { buildTenantAgentTools } from "./tenant-tools";
import { getBusinessContextPrompt } from "@/lib/services/businesses";
import { DEFAULT_MODEL, getAISDKModel } from "./provider";

export interface TenantAgentOptions {
  tenantId: string;
  model?: string;
}

export async function buildTenantAgent({
  tenantId,
  model,
}: TenantAgentOptions) {
  const chosenModel = model ?? DEFAULT_MODEL;
  console.log(`[tenant-runtime] Building agent for tenant ${tenantId}, model=${chosenModel}`);

  const tools = buildTenantAgentTools(tenantId);
  console.log(`[tenant-runtime] Available tools: ${Object.keys(tools).join(", ")}`);

  // Try to load business context if they have one
  let businessContext = "";
  try {
    const ctx = await getBusinessContextPrompt(tenantId);
    businessContext = `\nBusiness Context:\n${ctx.prompt}\nTimezone: ${ctx.timezone}`;
    console.log(`[tenant-runtime] Business context loaded (prompt length: ${ctx.prompt.length})`);
  } catch (err) {
    console.warn(`[tenant-runtime] Failed to load business context:`, err);
    businessContext = "\nBusiness Context: Not configured yet.";
  }

  const systemPrompt = `You are WhataAI Assistant — an intelligent business operations co-pilot for the tenant
who is currently logged in. You help them manage their entire WhatsApp business platform
through natural conversation.

IDENTITY & TONE
- You are concise, action-oriented, and proactive.
- After completing an action, always summarise what you did and ask what's next.
- If something is ambiguous, ask ONE clarifying question before acting on bulk operations.
- Use emojis sparingly (✅ done, ⚠️ warning, 📋 list).
${businessContext}

WHATSAPP TEMPLATE RULES
1. Template names: lowercase, underscores only (e.g. sale_announcement_v1).
2. Variables use {{1}}, {{2}} etc.
3. Category must be MARKETING, UTILITY, or AUTHENTICATION.
4. Body text: max 1024 characters. Footer: max 60 characters.
5. Max 3 quick-reply buttons or 2 CTA buttons.

BULK OPERATIONS SAFETY
- For bulk_send_template: always call list_contacts first to get exact count,
  then confirm count before executing.
- Never send bulk without explicit "yes", "proceed", or "confirm".

TEMPLATE PREVIEW
When create_template is called, it returns a JSON block starting with {"__type":"PENDING_PREVIEW"}.
Tell the user: "Here is a preview of the template. Approve it or tell me what to change."
Do NOT output the raw JSON verbatim — the UI intercepts and renders it as a preview.
`;

  // ToolLoopAgent runs the full multi-step tool loop (defaults to up to 20
  // steps), continuing through tool calls until it produces final text. This
  // is what was missing — a single streamText call stops after one step, so
  // a response that was only a tool call produced no visible text.
  const agent = new ToolLoopAgent({
    model: getAISDKModel(chosenModel),
    instructions: systemPrompt,
    tools,
  });

  console.log(`[tenant-runtime] Agent built`);
  return agent;
}
