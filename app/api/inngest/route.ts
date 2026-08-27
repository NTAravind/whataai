import { serve } from "inngest/next";
import { ingest } from "@/lib/clients/ingest";
import { whatsappWebhookIngest } from "@/lib/inngest/functions/whatsapp-webhook-received";
import { mailWebhookIngest } from "@/lib/inngest/functions/mail-webhook-received";
import { messageInboundFunction } from "@/lib/inngest/functions/message-inbound";
import { outboundMessage } from "@/lib/inngest/functions/outbound-message";
import { scheduledMessageRunner } from "@/lib/inngest/functions/scheduled-message-runner";
import { usageReconcile } from "@/lib/inngest/functions/usage-reconcile";
import { flowDataExchangeHandler } from "@/lib/inngest/functions/flow-data-exchange";
import { kbDocumentChunker } from "@/lib/inngest/functions/kb-chunk";
import { bookingReminder } from "@/lib/inngest/functions/booking-reminder";
import { bulkSendTemplate } from "@/lib/inngest/functions/bulk-send-template";

export const maxDuration = 60;

export const { GET, POST, PUT } = serve({
  client: ingest,
  functions: [
    whatsappWebhookIngest,
    mailWebhookIngest,
    messageInboundFunction,
    outboundMessage,
    scheduledMessageRunner,
    usageReconcile,
    flowDataExchangeHandler,
    kbDocumentChunker,
    bookingReminder,
    bulkSendTemplate,
  ],
});
