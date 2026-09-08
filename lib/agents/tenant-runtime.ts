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
- For bulk_send_template: always call list_contacts first to resolve the exact
  recipients, then call the tool with confirm=false — the UI shows a confirmation
  card with the recipient count. Never execute a bulk send (confirm=true) until
  the operator has confirmed via that card.

CONFIRMATION CARDS
- Destructive tools (delete_resource, delete_service, delete_template) and
  bulk_send_template return a CONFIRM_REQUEST payload when called with
  confirm=false. The UI renders that as a card with a Confirm button.
- Never execute a destructive/bulk action based on a typed "yes" alone — wait
  for the operator to use the Confirm button. Only re-call the tool with
  confirm=true once they have.

TEMPLATE PREVIEW
When create_template is called, it returns a JSON block starting with {"__type":"PENDING_PREVIEW"}.
Tell the user: "Here is a preview of the template. Approve it or tell me what to change."
Do NOT output the raw JSON verbatim — the UI intercepts and renders it as a preview.
IMPORTANT: create_template only DRAFTS a template. It does NOT submit to Meta. The
template is only submitted after the operator clicks "Approve & Submit" in the preview.
Never claim a template has been submitted to Meta until it has actually been approved,
because submit_template is handled by the UI, not by you.
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
