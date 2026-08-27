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
  const [isHistoryOpen, setIsHistoryOpen] = useState(true);

  const loadSessions = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`/api/tenants/${tenantId}/chat/sessions`);
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch {
      /* ignore */
    }
  }, [tenantId]);

  const [transport, setTransport] = useState<DefaultChatTransport<UIMessage> | null>(null);

  useEffect(() => {
    const t = new DefaultChatTransport({
      api: `/api/tenants/${tenantId}/chat`,
      body: () => ({ sessionId: currentSessionIdRef.current ?? undefined }),
      fetch: async (input, init) => {
        const response = await fetch(input, init);
        const newSessionId = response.headers.get("x-session-id");
        if (newSessionId && newSessionId !== currentSessionIdRef.current) {
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
    onError: (err) => toast.error(err.message),
  });

  const isLoading = status === "streaming" || status === "submitted";

  const loadSessionHistory = async (id: string) => {
    if (!tenantId) return;
    currentSessionIdRef.current = id;
    setCurrentSessionId(id);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/chat/sessions?sessionId=${id}`);
      const data = await res.json();
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
    } catch {
      toast.error("Failed to load chat history");
    }
  };

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    fetch(`/api/tenants/${tenantId}/chat/sessions`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setSessions(data.sessions ?? []);
      })
      .catch(() => {
        /* ignore */
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleApproveTemplate = (template: PendingTemplatePayload) => {
    if (!sendMessage) return;
    sendMessage({
      text: `Template "${template.name}" has been approved by the operator. Please confirm that it has been submitted to Meta and proceed with the next steps.`
    });
  };

  const handleEditTemplate = (feedback: string) => {
    if (!sendMessage) return;
    sendMessage({
      text: `Please update the template: ${feedback}. Show me a new preview.`
    });
  };

  const extractPendingPreview = (text: string): PendingTemplatePayload | null => {
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
          <h2 className="text-sm font-medium">
            {currentSessionId 
              ? sessions.find(s => s.id === currentSessionId)?.title ?? "Chat Session"
              : "New Chat"}
          </h2>
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
                m.role === "assistant" ? extractPendingPreview(textContent) : null;

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
