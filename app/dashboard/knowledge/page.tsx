"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { BookOpenText, CheckCircle2, FileText, Info, Plus, Trash2, UploadCloud } from "lucide-react";
import { useTenant } from "@/components/providers/tenant-provider";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatDateTime } from "@/lib/format";
import type { KnowledgeDocumentRow } from "@/lib/api/types";

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "ready" || status === "indexed" || status === "completed") return "default";
  if (status === "failed" || status === "error") return "destructive";
  return "secondary";
}

function readableSize(content: string) {
  const bytes = new Blob([content]).size;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function KnowledgePage() {
  const { tenantId } = useTenant();
  const base = tenantId ? `/api/tenants/${tenantId}/kb-documents` : null;
  const docs = useApi<{ documents: KnowledgeDocumentRow[] }>(base);

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sourceType, setSourceType] = useState("manual");
  const [saving, setSaving] = useState(false);

  async function loadFile(file: File | undefined) {
    if (!file) return;
    setTitle((current) => current || file.name.replace(/\.[^.]+$/, ""));
    setSourceType("upload");
    try {
      setContent(await file.text());
    } catch {
      toast.error("Could not read that file. Try a .txt, .md, or .csv file.");
    }
  }

  function resetForm() {
    setTitle("");
    setContent("");
    setSourceType("manual");
  }

  async function create() {
    if (!base || !title.trim() || !content.trim()) return;
    setSaving(true);
    try {
      await api(base, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          rawContent: content.trim(),
          sourceType,
        }),
      });
      toast.success("Knowledge document uploaded");
      setOpen(false);
      resetForm();
      docs.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to upload document");
    } finally {
      setSaving(false);
    }
  }

  async function remove(document: KnowledgeDocumentRow) {
    if (!base) return;
    try {
      await api(`${base}/${document.id}`, { method: "DELETE" });
      toast.success("Knowledge document deleted");
      docs.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete document");
    }
  }

  const documents = docs.data?.documents ?? [];
  const readyCount = documents.filter((document) => ["ready", "indexed", "completed"].includes(document.status)).length;
  const pendingCount = documents.filter((document) => ["pending", "processing"].includes(document.status)).length;
  const failedCount = documents.filter((document) => ["failed", "error"].includes(document.status)).length;
  const canUpload = title.trim().length > 0 && content.trim().length > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader title="Knowledge base" description="Teach your agents the business facts they should rely on before answering customers">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="size-4" />
              Upload document
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Add knowledge</DialogTitle>
              <DialogDescription>
                Upload or paste customer-facing facts like hours, pricing, policies, FAQs, and appointment notes.
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
              <Tabs defaultValue="paste">
                <TabsList>
                  <TabsTrigger value="paste">
                    <FileText className="size-3.5" />
                    Paste text
                  </TabsTrigger>
                  <TabsTrigger value="file">
                    <UploadCloud className="size-3.5" />
                    Upload file
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="paste" className="mt-4 space-y-4">
                  <Alert>
                    <Info className="size-4" />
                    <AlertTitle>Make it agent-friendly</AlertTitle>
                    <AlertDescription>
                      Use clear headings and direct facts. Example: “Refund policy”, “Opening hours”, “Appointment prep”.
                    </AlertDescription>
                  </Alert>
                </TabsContent>

                <TabsContent value="file" className="mt-4 space-y-4">
                  <div className="rounded-xl border border-dashed bg-muted/30 p-5">
                    <div className="flex items-start gap-3">
                      <UploadCloud className="mt-0.5 size-5 text-muted-foreground" />
                      <div className="flex-1 space-y-3">
                        <div>
                          <p className="font-medium">Choose a readable document</p>
                          <p className="text-sm text-muted-foreground">Text, Markdown, and CSV files work best right now.</p>
                        </div>
                        <Input id="kb-file" type="file" accept=".txt,.md,.markdown,.csv" onChange={(event) => loadFile(event.target.files?.[0])} />
                      </div>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="kb-title">Title</Label>
                  <Input
                    id="kb-title"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Business hours and policies"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="kb-content">Content</Label>
                    <span className="text-xs text-muted-foreground">
                      {content.trim() ? `${content.trim().split(/\s+/).length} words · ${readableSize(content)}` : "No content yet"}
                    </span>
                  </div>
                  <Textarea
                    id="kb-content"
                    className="h-48 min-h-40 overflow-y-auto font-mono text-sm"
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    placeholder={`# Opening hours\nMonday–Friday: 9 AM–6 PM\n\n# Refund policy\nRefunds are available within 7 days…`}
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setOpen(false); resetForm(); }}>Cancel</Button>
              <Button onClick={create} disabled={saving || !canUpload}>
                {saving ? "Uploading…" : "Add to knowledge base"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageHeader>

      {docs.loading ? (
        <LoadingState rows={5} />
      ) : docs.error ? (
        <ErrorState message={docs.error} onRetry={docs.reload} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <BookOpenText className="size-5" />
                </div>
                <div>
                  <p className="text-2xl font-semibold">{documents.length}</p>
                  <p className="text-xs text-muted-foreground">Documents</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <CheckCircle2 className="size-5" />
                </div>
                <div>
                  <p className="text-2xl font-semibold">{readyCount}</p>
                  <p className="text-xs text-muted-foreground">Ready for agents</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-semibold">{pendingCount}</p>
                <p className="text-xs text-muted-foreground">Processing</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-2xl font-semibold">{failedCount}</p>
                <p className="text-xs text-muted-foreground">Failed</p>
              </CardContent>
            </Card>
          </div>

          {failedCount > 0 ? (
            <Alert variant="destructive">
              <Info className="size-4" />
              <AlertTitle>{failedCount} document{failedCount === 1 ? "" : "s"} need attention</AlertTitle>
              <AlertDescription>Delete failed documents and upload them again with plain text content.</AlertDescription>
            </Alert>
          ) : null}

          {documents.length === 0 ? (
            <Card>
              <CardContent className="p-6">
                <EmptyState title="No knowledge documents yet" description="Upload business details so agents can answer factual questions accurately." />
                <div className="mt-4 flex justify-center gap-2">
                  <Button size="sm" onClick={() => setOpen(true)}>
                    <Plus className="size-4" />
                    Upload first document
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href="/dashboard/agents">Check agent tools</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Documents</CardTitle>
                <CardDescription>Agents search these documents before answering factual business questions.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Document</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Uploaded</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.map((document) => (
                      <TableRow key={document.id}>
                        <TableCell>
                          <div className="flex min-w-0 items-center gap-2">
                            <FileText className="size-4 shrink-0 text-muted-foreground" />
                            <span className="truncate font-medium">{document.title}</span>
                          </div>
                        </TableCell>
                        <TableCell><Badge variant="outline">{document.source_type}</Badge></TableCell>
                        <TableCell><Badge variant={statusVariant(document.status)}>{document.status}</Badge></TableCell>
                        <TableCell className="text-muted-foreground">{formatDateTime(document.created_at)}</TableCell>
                        <TableCell>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="size-8 text-destructive">
                                <Trash2 className="size-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete document?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  “{document.title}” will be removed from the agent knowledge base.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => remove(document)}>Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
