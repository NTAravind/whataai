import { supabaseAdmin, unwrap } from "@/lib/clients/supabase";
import { inngest } from "@/lib/clients/ingest";
import { kbDocumentUploaded } from "@/lib/inngest/events";

/** Create a knowledge-base document and enqueue chunking/embedding. */
export async function createDocument(input: {
  tenantId: string;
  title: string;
  rawContent: string;
  sourceType?: string;
}) {
  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("knowledge_base_documents")
    .insert({
      tenant_id: input.tenantId,
      title: input.title,
      raw_content: input.rawContent,
      source_type: input.sourceType ?? "manual",
      status: "pending",
    })
    .select()
    .single();
  if (error) throw error;

  await inngest.send({
    id: `kb-${data.id}`,
    name: kbDocumentUploaded.name,
    data: { documentId: data.id, tenantId: input.tenantId },
  });

  return data;
}

export async function listDocuments(tenantId: string) {
  return unwrap(
    await supabaseAdmin()
      .from("knowledge_base_documents")
      .select("id, title, source_type, status, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
  );
}

export async function getDocument(documentId: string) {
  return unwrap(await supabaseAdmin().from("knowledge_base_documents").select("*").eq("id", documentId).single());
}

export async function deleteDocument(tenantId: string, documentId: string) {
  await supabaseAdmin()
    .from("knowledge_base_chunks")
    .delete()
    .eq("document_id", documentId)
    .in("tenant_id", [tenantId]);
  return supabaseAdmin()
    .from("knowledge_base_documents")
    .delete()
    .eq("id", documentId)
    .eq("tenant_id", tenantId);
}

/**
 * MVP retrieval — Postgres full-text search over chunks, tenant-scoped.
 * Swap in a pgvector similarity query (knowledge_base_chunks.embedding) once
 * an embedding model/dimension is wired up; callers stay unchanged.
 */
export async function searchKnowledgeBase(tenantId: string, query: string, limit = 5) {
  const q = query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[^a-zA-Z0-9_-]/g, "") + ":*")
    .join(" & ");

  if (!q) return [];

  const { data, error } = await supabaseAdmin()
    .from("knowledge_base_chunks")
    .select("id, document_id, content, chunk_index")
    .eq("tenant_id", tenantId)
    .textSearch("content_tsv", q, { type: "websearch" })
    .limit(limit);

  if (error) return [];
  return data;
}

/** Naive paragraph splitter used by the kb ingest function. */
export function chunkText(raw: string, maxLen = 1000): string[] {
  const paragraphs = raw.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if ((current + "\n\n" + para).length > maxLen && current) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [raw.slice(0, maxLen)];
}
