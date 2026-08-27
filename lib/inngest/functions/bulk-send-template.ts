import { inngest } from "@/lib/clients/ingest";
import { supabaseAdmin } from "@/lib/clients/supabase";
import { enqueueOutboundMessage } from "@/lib/services/messages";

import { whatsappBulkSend } from "@/lib/inngest/events";

export const bulkSendTemplate = inngest.createFunction(
  { 
    id: "bulk-send-template", 
    name: "Bulk Send WhatsApp Template",
    triggers: [whatsappBulkSend],
  },
  async ({ event, step }) => {
    const { tenantId, templateName, contactIds, variables } = event.data;

    // 1. Get the tenant's default WA account
    const waAccount = await step.run("get-wa-account", async () => {
      const { data } = await supabaseAdmin()
        .from("wa_accounts")
        .select("id")
        .eq("tenant_id", tenantId)
        .limit(1)
        .single();
      if (!data) throw new Error("No WhatsApp account found for tenant");
      return data;
    });

    // 2. Fetch the actual template ID from name (in a real app we might pass ID, but here we pass name)
    const templateRow = await step.run("get-template", async () => {
      const { data } = await supabaseAdmin()
        .from("whatsapp_templates")
        .select("id, status")
        .eq("tenant_id", tenantId)
        .eq("name", templateName)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (!data) throw new Error(`Template ${templateName} not found`);
      if (data.status !== "approved") {
        throw new Error(`Template ${templateName} is not approved yet (status: ${data.status})`);
      }
      return data;
    });

    // 3. Process contacts in chunks of 5 to respect API rate limits / DB load
    const CHUNK_SIZE = 5;
    for (let i = 0; i < contactIds.length; i += CHUNK_SIZE) {
      const chunk = contactIds.slice(i, i + CHUNK_SIZE);
      
      await step.run(`process-chunk-${i}`, async () => {
        const { data: contacts } = await supabaseAdmin()
          .from("contacts")
          .select("id, phone_number")
          .in("id", chunk)
          .eq("tenant_id", tenantId);
          
        if (!contacts) return;

        for (const contact of contacts) {
          if (!contact.phone_number) continue;
          
          await enqueueOutboundMessage({
            tenantId,
            channel: "whatsapp",
            channelAccountId: waAccount.id,
            contactId: contact.id,
            senderId: contact.phone_number,
            templateId: templateRow.id,
            content: {
              type: "template",
              meta: { template_name: templateName, parameters: variables || {} }
            }
          });
        }
      });
      
      // Delay between chunks to avoid rate limiting
      if (i + CHUNK_SIZE < contactIds.length) {
        await step.sleep("throttle", "2s");
      }
    }

    return { processed: contactIds.length };
  }
);
