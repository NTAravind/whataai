"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

interface PendingAction {
  id: string;
  tool_name: string;
  tool_args: Record<string, unknown>;
  conversation_id: string;
  created_at: string;
}

export function PendingActionCard({
  action,
  tenantId,
  onResolved,
}: {
  action: PendingAction;
  tenantId: string;
  onResolved: () => void;
}) {
  const [loading, setLoading] = useState(false);

  async function handleAction(type: "approve" | "reject") {
    setLoading(true);
    try {
      const res = await fetch(`/api/tenants/${tenantId}/agent/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: action.id, action: type }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success(type === "approve" ? "Approved" : "Rejected");
      onResolved();
    } catch {
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="border-amber-200 bg-amber-50">
      <CardHeader>
        <CardTitle className="text-sm">
          Pending: {action.tool_name.replace(/_/g, " ")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="text-xs text-muted-foreground mb-3 overflow-auto max-h-32">
          {JSON.stringify(action.tool_args, null, 2)}
        </pre>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => handleAction("approve")} disabled={loading}>
            Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => handleAction("reject")} disabled={loading}>
            Reject
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
