"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, MailPlus, SendHorizonal } from "lucide-react";
import { useTenant } from "@/components/providers/tenant-provider";
import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ErrorState, LoadingState } from "@/components/data-state";
import { formatDateTime } from "@/lib/format";
import type { ConversationSummary, MessageRow, TemplateRow } from "@/lib/api/types";

function Bubble({ message }: { message: MessageRow }) {
  const isUser = message.role === "user";
  const text = message.content?.text;
  const type = message.content?.type;
  return (
    <div className={cn("flex", isUser ? "justify-start" : "justify-end")}>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm",
          isUser ? "rounded-bl-md bg-muted" : "rounded-br-md bg-primary text-primary-foreground",
        )}
      >
        {text ? <p className="whitespace-pre-wrap break-words">{text}</p> : null}
        {!text ? (
          <p className={cn("text-xs", isUser ? "text-muted-foreground" : "text-primary-foreground/70")}>
            {type ? `[${type} message]` : "No text content"}
          </p>
        ) : null}
        <p
          className={cn(
            "mt-1 text-right text-[10px]",
            isUser ? "text-muted-foreground" : "text-primary-foreground/60",
          )}
        >
          {formatDateTime(message.created_at)}
          {message.status ? ` · ${message.status}` : ""}
        </p>
      </div>
    </div>
  );
}

export default function ConversationThreadPage() {
  const params = useParams<{ conversationId: string }>();
  const { tenantId } = useTenant();
  const conversationId = params.conversationId;

  const base = tenantId && conversationId ? `/api/tenants/${tenantId}/conversations/${conversationId}` : null;
  const { data, loading, error, reload } = useApi<{
    conversation: ConversationSummary;
    messages: MessageRow[];
  }>(base);
  const templates = useApi<{ templates: TemplateRow[] }>(
    tenantId ? `/api/tenants/${tenantId}/templates` : null,
  );

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [templateParams, setTemplateParams] = useState("{}");
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.messages.length, data?.conversation.id]);

  if (loading) return <LoadingState rows={5} />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const { conversation, messages } = data;
  const name =
    conversation.contact?.full_name ??
    conversation.contact?.phone_number ??
    conversation.contact?.email ??
    "Unknown";

  async function send() {
    const body = text.trim();
    if (!body || !base) return;
    setSending(true);
    try {
      await api(base, { method: "POST", body: JSON.stringify({ text: body }) });
      setText("");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  async function setStatus(status: string) {
    if (!base) return;
    try {
      await api(base, { method: "PATCH", body: JSON.stringify({ status }) });
      toast.success(`Marked as ${status}`);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update status");
    }
  }

  const approvedTemplates = (templates.data?.templates ?? []).filter(
    (template) =>
      template.status.toLowerCase() === "approved" &&
      (!conversation.wa_account_id || template.wa_account_id === conversation.wa_account_id),
  );
  const selectedTemplateId = templateId || approvedTemplates[0]?.id || "";
  const canSendTemplate =
    conversation.channel === "whatsapp" &&
    Boolean(conversation.wa_account_id) &&
    Boolean(conversation.contact?.phone_number);

  async function sendTemplate() {
    if (!tenantId || !conversation.wa_account_id || !conversation.contact?.phone_number || !selectedTemplateId) return;
    setSendingTemplate(true);
    try {
      let params: Record<string, unknown> = {};
      if (templateParams.trim()) {
        const parsed = JSON.parse(templateParams);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Params must be a JSON object");
        }
        params = parsed as Record<string, unknown>;
      }
      await api("/api/whatsapp/message/send-template", {
        method: "POST",
        body: JSON.stringify({
          tenantId,
          waAccountId: conversation.wa_account_id,
          conversationId,
          to: conversation.contact.phone_number,
          templateId: selectedTemplateId,
          params,
        }),
      });
      toast.success("Template queued");
      setTemplateOpen(false);
      setTemplateParams("{}");
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send template");
    } finally {
      setSendingTemplate(false);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-2rem)] max-w-4xl flex-col p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon">
            <Link href="/dashboard/conversations">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <p className="font-medium leading-tight">{name}</p>
            <p className="text-xs text-muted-foreground">
              {conversation.contact?.phone_number ?? conversation.contact?.email} · {conversation.channel}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={conversation.status === "active" ? "default" : "secondary"}>
            {conversation.status}
          </Badge>
          {canSendTemplate ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTemplateOpen(true)}
              disabled={templates.loading || approvedTemplates.length === 0}
            >
              <MailPlus className="size-3.5" />
              Template
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">Set status</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setStatus("active")}>Active</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatus("needs_human")}>Needs human</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatus("resolved")}>Resolved</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="mt-4 flex-1 space-y-3 overflow-y-auto rounded-xl border bg-background p-4">
        {messages.map((m) => (
          <Bubble key={m.id} message={m} />
        ))}
        <div ref={endRef} />
      </div>

      <div className="mt-3 flex items-end gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Type a reply… (Enter to send, Shift+Enter for newline)"
          className="max-h-40 min-h-12 flex-1"
        />
        <Button onClick={send} disabled={sending || !text.trim()} size="icon" className="h-12 w-12">
          <SendHorizonal className="size-4" />
        </Button>
      </div>

      <Dialog open={templateOpen} onOpenChange={setTemplateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Send WhatsApp template</DialogTitle>
            <DialogDescription>
              Use this for approved Meta templates, including messages outside the 24-hour reply window.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Template</Label>
              <Select value={selectedTemplateId} onValueChange={setTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a template" />
                </SelectTrigger>
                <SelectContent>
                  {approvedTemplates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name} · {template.language}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-params">Parameters JSON</Label>
              <Textarea
                id="template-params"
                className="min-h-24 font-mono text-xs"
                value={templateParams}
                onChange={(event) => setTemplateParams(event.target.value)}
                placeholder='{"1":"Acme"}'
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateOpen(false)}>Cancel</Button>
            <Button onClick={sendTemplate} disabled={sendingTemplate || !selectedTemplateId}>
              {sendingTemplate ? "Queueing…" : "Queue template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
