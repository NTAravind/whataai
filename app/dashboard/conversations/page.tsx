"use client";

import Link from "next/link";
import { MessageSquareWarning, Phone, Mail } from "lucide-react";
import { useTenant } from "@/components/providers/tenant-provider";
import { useApi } from "@/hooks/use-api";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ErrorState, EmptyState, LoadingState } from "@/components/data-state";
import { formatRelative } from "@/lib/format";
import type { ConversationSummary } from "@/lib/api/types";

function ChannelIcon({ channel }: { channel: "whatsapp" | "mail" }) {
  return channel === "whatsapp" ? <Phone className="size-3.5" /> : <Mail className="size-3.5" />;
}

export default function ConversationsPage() {
  const { tenantId } = useTenant();
  const { data, loading, error, reload } = useApi<{ conversations: ConversationSummary[] }>(
    tenantId ? `/api/tenants/${tenantId}/conversations` : null,
  );

  const conversations = data?.conversations ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHeader
        title="Conversations"
        description="Inbox of all customer threads across channels"
      />

      {loading ? (
        <LoadingState rows={6} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : conversations.length === 0 ? (
        <EmptyState
          title="No conversations yet"
          description="When customers message your WhatsApp number, their threads appear here."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <ul className="divide-y">
            {conversations.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/dashboard/conversations/${c.id}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/60"
                >
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <ChannelIcon channel={c.channel} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">
                        {c.contact?.full_name ?? c.contact?.phone_number ?? c.contact?.email ?? "Unknown"}
                      </p>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatRelative(c.last_message_at)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <p className="truncate text-xs text-muted-foreground">
                        {c.contact?.phone_number ?? c.contact?.email}
                        {c.agent ? ` · ${c.agent.name}` : ""}
                      </p>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {c.status === "needs_human" ? (
                          <Badge variant="destructive">
                            <MessageSquareWarning className="size-3" />
                            needs human
                          </Badge>
                        ) : null}
                        {c.unread_count > 0 ? <Badge variant="secondary">{c.unread_count}</Badge> : null}
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button asChild variant="outline" size="sm">
          <Link href="/dashboard">Back to overview</Link>
        </Button>
      </div>
    </div>
  );
}
