"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  getToolName,
  ToolUIPart,
  UIMessage,
} from "ai";
import { useTenant } from "@/components/providers/tenant-provider";
import {
  WhatsAppTemplatePreview,
  type PendingTemplatePayload,
} from "@/components/whatsapp-template-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, MessageSquare, Loader2, Send, Bot, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MODELS, DEFAULT_MODEL } from "@/lib/agents/provider";

export function ChatClient() {
  const { tenant } = useTenant();
  
  if (!tenant?.id) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }

  return <ChatClientInner tenantId={tenant.id} />;
}

function ChatClientInner({ tenantId }: { tenantId: string }) {
  const [sessions, setSessions] = useState<{ id: string; title: string | null }[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  const [input, setInput] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const modelRef = useRef(DEFAULT_MODEL);
  const [isHistoryOpen, setIsHistoryOpen] = useState(true);

  const loadSessions = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`/api/tenants/${tenantId}/chat/sessions`);
      const data = await res.json();
      console.log(`[chat-client] Refreshed ${data.sessions?.length ?? 0} sessions`);
      setSessions(data.sessions ?? []);
    } catch (err) {
      console.error(`[chat-client] Failed to refresh sessions:`, err);
    }
  }, [tenantId]);

  const [transport, setTransport] = useState<DefaultChatTransport<UIMessage> | null>(null);

  useEffect(() => {
    const t = new DefaultChatTransport({
      api: `/api/tenants/${tenantId}/chat`,
      body: () => ({ sessionId: currentSessionIdRef.current ?? undefined, model: modelRef.current }),
      fetch: async (input, init) => {
        console.log(`[chat-client] Fetching ${input}`, { method: init?.method, bodyLength: (init?.body as string)?.length });
        const response = await fetch(input, init);
        console.log(`[chat-client] Response status: ${response.status}, ok: ${response.ok}`);
        if (!response.ok) {
          const text = await response.text().catch(() => "unable to read body");
          console.error(`[chat-client] Error response body:`, text);
        }
        const newSessionId = response.headers.get("x-session-id");
        if (newSessionId && newSessionId !== currentSessionIdRef.current) {
          console.log(`[chat-client] New session ID: ${newSessionId}`);
          currentSessionIdRef.current = newSessionId;
          setCurrentSessionId(newSessionId);
          loadSessions();
        }
        return response;
      },
    });
    setTransport(t);
  }, [tenantId, loadSessions]);

  const { messages, setMessages, status, sendMessage } = useChat({
    transport: transport ?? undefined,
    onError: (err) => {
      console.error("[chat-client] useChat error:", err);
      toast.error(`Copilot error: ${err.message}`);
    },
  });

  const isLoading = status === "streaming" || status === "submitted";

  useEffect(() => {
    console.log(`[chat-client] Status changed: ${status}`);
  }, [status]);

  const loadSessionHistory = async (id: string) => {
    if (!tenantId) return;
    currentSessionIdRef.current = id;
    setCurrentSessionId(id);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/chat/sessions?sessionId=${id}`);
      const data = await res.json();
      console.log(`[chat-client] Loaded session ${id}: ${data.history?.length ?? 0} messages`);
      // API returns ModelMessage[]; map to UIMessage[] for useChat
      const history: UIMessage[] = (data.history ?? []).map(
        (msg: { role: string; content: unknown }, i: number) => ({
          id: `${id}-${i}`,
          role: msg.role === "assistant" ? "assistant" : "user",
          parts: [
            {
              type: "text",
              text:
                typeof msg.content === "string"
                  ? msg.content
                  : JSON.stringify(msg.content),
            },
          ],
        }),
      );
      setMessages(history);
    } catch (err) {
      console.error(`[chat-client] Failed to load session ${id}:`, err);
      toast.error("Failed to load chat history");
    }
  };

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    fetch(`/api/tenants/${tenantId}/chat/sessions`)
      .then((res) => res.json())
      .then((data) => {
        console.log(`[chat-client] Loaded ${data.sessions?.length ?? 0} sessions`);
        if (!cancelled) setSessions(data.sessions ?? []);
      })
      .catch((err) => {
        console.error(`[chat-client] Failed to load sessions:`, err);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    console.log(`[chat-client] Messages updated: ${messages.length} total, latest role=${messages[messages.length - 1]?.role ?? "none"}`);
  }, [messages]);

  const handleApproveTemplate = (template: PendingTemplatePayload) => {
    if (!sendMessage) return;
    console.log(`[chat-client] Sending template approval for: ${template.name}`);
    sendMessage({
      text: `Template "${template.name}" has been approved by the operator. Please confirm that it has been submitted to Meta and proceed with the next steps.`
    });
  };

  const handleEditTemplate = (feedback: string) => {
    if (!sendMessage) return;
    console.log(`[chat-client] Sending template edit feedback`);
    sendMessage({
      text: `Please update the template: ${feedback}. Show me a new preview.`
    });
  };

  const extractPendingPreview = (m: UIMessage): PendingTemplatePayload | null => {
    // Prefer the create_template tool output part (multi-step agent stream).
    for (const part of m.parts) {
      if (typeof part.type !== "string" || !part.type.startsWith("tool-")) continue;
      const tool = part as ToolUIPart;
      if (getToolName(tool) !== "create_template" || tool.state !== "output-available") {
        continue;
      }
      const output = tool.output as { __type?: string; template?: PendingTemplatePayload };
      if (output?.__type === "PENDING_PREVIEW" && output.template) {
        return output.template;
      }
      // Some versions stringify the output.
      if (output && typeof output !== "object" && String(output).includes("PENDING_PREVIEW")) {
        try {
          const parsed = JSON.parse(String(output));
          if (parsed.__type === "PENDING_PREVIEW") return parsed.template;
        } catch {
          /* ignore */
        }
      }
    }

    // Fallback: the assistant's rendered text may still contain the JSON.
    const text =
      m.parts.find((p) => p.type === "text" && "text" in p)?.text ?? "";
    const match = text.match(/\{[\s\S]*"__type"\s*:\s*"PENDING_PREVIEW"[\s\S]*\}/);
    if (!match) return null;
    try {
      const parsed = JSON.parse(match[0]);
      if (parsed.__type === "PENDING_PREVIEW") return parsed.template as PendingTemplatePayload;
    } catch {
      /* ignore */
    }
    return null;
  };

  const suggestedActions = [
    "List my contacts",
    "Show this month's usage",
    "List all pending bookings",
    "Create a promotional WhatsApp template",
  ];

  return (
    <div className="flex h-full overflow-hidden border rounded-lg shadow-sm bg-background">
      {isHistoryOpen && (
        <aside className="w-60 shrink-0 flex flex-col border-r bg-muted/30">
          <div className="p-3 border-b flex items-center gap-2">
            <Button
              variant="outline"
              className="flex-1 justify-start gap-2 text-sm"
              onClick={() => {
                currentSessionIdRef.current = null;
                setCurrentSessionId(null);
                setMessages([]);
              }}
            >
              <Plus className="h-4 w-4" />
              New Chat
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setIsHistoryOpen(false)} className="h-9 w-9 shrink-0">
              <PanelLeftClose className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.length === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-3">No past chats yet.</p>
          )}
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => loadSessionHistory(s.id)}
              className={cn(
                "w-full text-left px-3 py-2 text-sm rounded-md transition-colors flex items-center gap-2",
                s.id === currentSessionId
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{s.title ?? "New Chat"}</span>
            </button>
          ))}
        </div>
      </aside>
      )}

      <div className="flex flex-1 flex-col min-w-0 relative bg-background">
        <header className="flex items-center gap-3 border-b px-4 py-2.5 bg-background">
          {!isHistoryOpen && (
            <Button variant="ghost" size="icon" onClick={() => setIsHistoryOpen(true)} className="h-8 w-8 shrink-0">
              <PanelLeftOpen className="h-4 w-4 text-muted-foreground" />
            </Button>
          )}
          <h2 className="text-sm font-medium min-w-0 truncate">
            {currentSessionId 
              ? sessions.find(s => s.id === currentSessionId)?.title ?? "Chat Session"
              : "New Chat"}
          </h2>
          <div className="ml-auto">
            <Select
              value={model}
              onValueChange={(v) => {
                modelRef.current = v;
                setModel(v);
              }}
            >
              <SelectTrigger className="h-8 w-auto min-w-[12rem] text-xs">
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent>
                {Array.from(new Set(MODELS.map((m) => m.group))).map((group) => (
                  <SelectGroup key={group}>
                    <SelectLabel>{group}</SelectLabel>
                    {MODELS.filter((m) => m.group === group).map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-center">
              <Bot className="h-12 w-12 text-muted-foreground/40" />
              <div>
                <h3 className="text-lg font-semibold">WhataAI Co-pilot</h3>
                <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                  I can create templates, send campaigns, manage bookings, and more — just ask.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 max-w-sm w-full mt-2">
                {suggestedActions.map((action) => (
                  <button
                    key={action}
                    onClick={() => sendMessage?.({ text: action })}
                    className="text-left text-sm border rounded-lg px-3 py-2 hover:bg-accent transition-colors"
                  >
                    {action}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m: UIMessage) => {
              if (m.role === "system") return null;

              const textContent =
                m.parts.find((p) => p.type === "text")?.text || "";

              const toolParts = m.parts.filter(
                (p): p is ToolUIPart =>
                  typeof p.type === "string" && p.type.startsWith("tool-"),
              );

              const pendingPreview =
                m.role === "assistant" ? extractPendingPreview(m) : null;

              if (pendingPreview) {
                return (
                  <div key={m.id} className="flex flex-col items-start gap-2">
                    <p className="text-sm text-muted-foreground">
                      Here is a preview of the template. Approve it or tell me what to change.
                    </p>
                    <WhatsAppTemplatePreview
                      template={pendingPreview}
                      onApprove={handleApproveTemplate}
                      onEdit={handleEditTemplate}
                    />
                  </div>
                );
              }

              return (
                <div
                  key={m.id}
                  className={cn(
                    "flex",
                    m.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground rounded-br-sm"
                        : "bg-muted text-foreground rounded-bl-sm"
                    )}
                  >
                    {textContent}
                    {toolParts.length > 0 &&
                      toolParts.map((tool, idx: number) => (
                        <div
                          key={tool.toolCallId || idx}
                          className="mt-1.5 flex items-center gap-1 text-xs opacity-60 bg-black/5 rounded px-2 py-1"
                        >
                          {tool.providerExecuted || tool.state === "output-available" ? (
                            "✅"
                          ) : (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          )}
                          <span>{getToolName(tool)}</span>
                        </div>
                      ))}
                  </div>
                </div>
              );
            })
          )}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-2.5 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Thinking…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t p-3 bg-background">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!input.trim() || !sendMessage) return;
              console.log(`[chat-client] Sending message: "${input.substring(0, 50)}..."`);
              sendMessage({ text: input });
              setInput("");
            }}
            className="flex items-center gap-2"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a command…"
              className="flex-1"
              disabled={isLoading}
              autoComplete="off"
            />
            <Button type="submit" size="icon" disabled={isLoading || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
