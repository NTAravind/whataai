"use client";

import { Badge } from "@/components/ui/badge";

interface BookingDataDisplayProps {
  data: Record<string, unknown>;
  schemaFields?: { id: string; label: string; role?: string }[];
}

export function BookingDataDisplay({ data, schemaFields = [] }: BookingDataDisplayProps) {
  const entries = Object.entries(data ?? {});

  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">No additional booking data collected.</p>
    );
  }

  // Create a map of field_id to label for clean rendering
  const labelMap = new Map<string, string>();
  schemaFields.forEach((f) => labelMap.set(f.id, f.label));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
      {entries.map(([key, value]) => {
        const displayLabel = labelMap.get(key) ?? key.replace(/_/g, " ");
        let formattedValue = String(value);

        if (typeof value === "boolean") {
          formattedValue = value ? "Yes" : "No";
        } else if (Array.isArray(value)) {
          formattedValue = value.join(", ");
        } else if (typeof value === "object" && value !== null) {
          formattedValue = JSON.stringify(value);
        }

        return (
          <div key={key} className="rounded-lg border bg-card/60 p-3">
            <dt className="text-xs font-medium text-muted-foreground capitalize flex items-center gap-1">
              {displayLabel}
              {!labelMap.has(key) && (
                <Badge variant="outline" className="font-mono text-[9px] px-1 py-0">
                  {key}
                </Badge>
              )}
            </dt>
            <dd className="mt-1 font-semibold text-foreground text-sm break-words">
              {formattedValue || <span className="text-muted-foreground italic">N/A</span>}
            </dd>
          </div>
        );
      })}
    </div>
  );
}
