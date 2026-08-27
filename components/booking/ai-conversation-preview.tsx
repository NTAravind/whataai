"use client";

import { useState } from "react";
import { Bot, CheckCircle2, Circle, MessageSquare, RefreshCw, Send, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { SchemaField } from "@/lib/booking/schema-types";

interface AIConversationPreviewProps {
  serviceName: string;
  fields: SchemaField[];
}

interface ChatMessage {
  id: string;
  sender: "ai" | "user";
  text: string;
}

export function AIConversationPreview({
  serviceName,
  fields,
}: AIConversationPreviewProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => getInitialMessages(serviceName, fields));
  const [collectedData, setCollectedData] = useState<Record<string, string>>({});
  const [currentFieldIndex, setCurrentFieldIndex] = useState(0);
  const [userInput, setUserInput] = useState("");

  function getInitialMessages(sName: string, schemaFields: SchemaField[]) {
    const firstField = schemaFields[0];
    const initialAiMsg = firstField?.ai?.question
      ? `Hello! I can help you book a ${sName}. ${firstField.ai.question}`
      : `Hello! I'd be happy to assist you with booking ${sName}. What date would you prefer?`;

    return [
      {
        id: "1",
        sender: "ai" as const,
        text: initialAiMsg,
      },
    ];
  }

  function handleReset() {
    setMessages(getInitialMessages(serviceName, fields));
    setCollectedData({});
    setCurrentFieldIndex(0);
    setUserInput("");
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!userInput.trim()) return;

    const text = userInput.trim();
    const userMsg: ChatMessage = { id: String(Date.now()), sender: "user", text };
    const newMessages = [...messages, userMsg];

    // Simulate extraction for current field
    const currentField = fields[currentFieldIndex];
    let nextData = { ...collectedData };

    if (currentField) {
      nextData[currentField.id] = text;
      setCollectedData(nextData);
    }

    const nextIndex = currentFieldIndex + 1;
    setCurrentFieldIndex(nextIndex);

    let aiReply = "";
    if (nextIndex < fields.length) {
      const nextField = fields[nextIndex];
      const q = nextField.ai?.question ?? `Could you please provide your ${nextField.label}?`;
      const ack = currentField?.ai?.confirmation
        ? currentField.ai.confirmation.replace("{{value}}", text)
        : `Got it!`;
      aiReply = `${ack} ${q}`;
    } else {
      const summary = Object.entries(nextData)
        .map(([k, v]) => `${fields.find((f) => f.id === k)?.label ?? k}: ${v}`)
        .join(", ");
      aiReply = `Great! I have all your details: ${summary}. Your booking for ${serviceName} is confirmed!`;
    }

    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        { id: String(Date.now() + 1), sender: "ai", text: aiReply },
      ]);
    }, 400);

    setUserInput("");
  }

  return (
    <div className="grid gap-6 lg:grid-cols-12">
      {/* Left: Chat Simulator */}
      <Card className="lg:col-span-7 flex flex-col h-[520px]">
        <CardHeader className="py-3 px-4 border-b flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="size-2 rounded-full bg-emerald-500 animate-pulse" />
            <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
              <MessageSquare className="size-4 text-emerald-600" />
              WhatsApp AI Simulator
            </CardTitle>
          </div>
          <Button variant="ghost" size="icon" className="size-8" onClick={handleReset} title="Reset Conversation">
            <RefreshCw className="size-3.5" />
          </Button>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto p-4 space-y-3 bg-muted/20">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex items-start gap-2 ${
                m.sender === "user" ? "flex-row-reverse" : "flex-row"
              }`}
            >
              <div
                className={`size-7 rounded-full flex items-center justify-center shrink-0 ${
                  m.sender === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-emerald-600 text-white"
                }`}
              >
                {m.sender === "user" ? <User className="size-4" /> : <Bot className="size-4" />}
              </div>
              <div
                className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                  m.sender === "user"
                    ? "bg-primary text-primary-foreground rounded-tr-none"
                    : "bg-card border text-card-foreground rounded-tl-none"
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}
        </CardContent>

        <form onSubmit={handleSend} className="p-3 border-t flex gap-2 bg-card">
          <Input
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder="Type a simulated customer message..."
            className="flex-1 text-sm"
          />
          <Button type="submit" size="sm">
            <Send className="size-3.5" />
          </Button>
        </form>
      </Card>

      {/* Right: Collected State Panel */}
      <Card className="lg:col-span-5 flex flex-col h-[520px]">
        <CardHeader className="py-3 px-4 border-b">
          <CardTitle className="text-sm font-semibold">Collected Schema State</CardTitle>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-3">
          {fields.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No fields configured in schema yet.</p>
          ) : (
            fields.map((field) => {
              const val = collectedData[field.id];
              const isCollected = Boolean(val);
              return (
                <div
                  key={field.id}
                  className={`rounded-lg border p-3 text-xs transition-colors ${
                    isCollected
                      ? "bg-emerald-500/10 border-emerald-500/30"
                      : "bg-muted/40 border-border"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold flex items-center gap-1.5">
                      {isCollected ? (
                        <CheckCircle2 className="size-3.5 text-emerald-600" />
                      ) : (
                        <Circle className="size-3.5 text-muted-foreground" />
                      )}
                      {field.label}
                    </span>
                    <Badge variant="outline" className="font-mono text-[9px]">
                      {field.id}
                    </Badge>
                  </div>
                  <div className="mt-1.5">
                    {isCollected ? (
                      <p className="font-semibold text-foreground text-sm">{val}</p>
                    ) : (
                      <p className="text-muted-foreground italic">Waiting for input...</p>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
