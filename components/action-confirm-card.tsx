"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertTriangle } from "lucide-react";

export interface ConfirmRequestPayload {
  __type: "CONFIRM_REQUEST";
  confirmKind: string;
  title: string;
  message: string;
  confirmText: string;
}

interface ActionConfirmCardProps {
  request: ConfirmRequestPayload;
  onConfirm: () => void;
  onCancel?: () => void;
  submitting?: boolean;
}

export function ActionConfirmCard({
  request,
  onConfirm,
  onCancel,
  submitting = false,
}: ActionConfirmCardProps) {
  return (
    <Card className="max-w-sm my-4 p-4 border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">{request.title}</h4>
          <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
            {request.message}
          </p>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={onConfirm} disabled={submitting}>
              Confirm
            </Button>
            {onCancel && (
              <Button size="sm" variant="outline" onClick={onCancel} disabled={submitting}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}