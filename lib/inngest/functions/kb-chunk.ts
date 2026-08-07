import { inngest } from "@/lib/clients/ingest";
import { kbDocumentUploaded } from "@/lib/inngest/events";
import { supabaseAdmin } from "@/lib/clients/supabase";
import { getDocument, chunkText } from "@/lib/services/kb";

/**
 * KB ingestion (docs/guide.md §7 — `kb.document.uploaded`).
 *
 * MVP: chunk by paragraphs and rely on Postgres FTS (content_tsv). The chunks
 * table also carries `embedding`, so the same function can later upsert
 * vectors without callers changing.
 */
export const kbDocumentChunker = inngest.createFunction(
  {
    id: "kb-document-chunker",
    name: "KB Document Chunker",
    triggers: [kbDocumentUploaded],
    idempotency: "event.data.documentId",
    retries: 3,
  },
  async ({ event, step }) => {
    const { documentId, tenantId } = event.data;

    const doc = (await step.run("load-document", () => getDocument(documentId))) as
      | { raw_content: string | null; status?: string | null }
      | null;
    const rawContent = doc?.raw_content ?? null;
    if (!rawContent) {
      return { skipped: true, reason: "no raw_content" };
    }

    const chunks = await step.run("chunk", () => chunkText(rawContent));

    await step.run("persist-chunks", async () => {
      const { error } = await supabaseAdmin().from("knowledge_base_chunks").insert(
        chunks.map((content, index) => ({
          document_id: documentId,
          tenant_id: tenantId,
          chunk_index: index,
          content,
          token_count: content.split(/\s+/).length,
        })),
      );
      if (error) throw error;
    });

    await step.run("mark-ready", () =>
      supabaseAdmin()
        .from("knowledge_base_documents")
        .update({ status: "ready" })
        .eq("id", documentId),
    );

    return { documentId, chunks: chunks.length };
  },
);
