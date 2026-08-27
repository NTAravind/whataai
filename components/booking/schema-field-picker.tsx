"use client";

import {
  FIELD_TYPES_CONFIG,
  type SchemaField,
  type SchemaFieldType,
} from "@/lib/booking/schema-types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SchemaFieldPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectType: (field: SchemaField) => void;
}

export function SchemaFieldPicker({
  open,
  onOpenChange,
  onSelectType,
}: SchemaFieldPickerProps) {
  function handlePick(cfg: (typeof FIELD_TYPES_CONFIG)[0]) {
    const rawId = cfg.label.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const newField: SchemaField = {
      id: rawId,
      label: cfg.label,
      type: cfg.type,
      required: true,
      role: cfg.defaultRole,
      ai: {
        question: `What ${cfg.label.toLowerCase()} would you prefer?`,
        confirmation: `You selected {{value}} for ${cfg.label}. Is that correct?`,
      },
    };

    onSelectType(newField);
    onOpenChange(false);
  }

  const categories: ("Basic" | "Date & Time" | "Selection" | "Booking")[] = [
    "Basic",
    "Date & Time",
    "Selection",
    "Booking",
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Booking Requirement Field</DialogTitle>
          <DialogDescription>
            Choose a field type to add to your service booking schema.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {categories.map((cat) => {
            const typesInCat = FIELD_TYPES_CONFIG.filter((t) => t.category === cat);
            return (
              <div key={cat} className="space-y-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {cat}
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {typesInCat.map((cfg) => (
                    <button
                      key={cfg.type}
                      type="button"
                      onClick={() => handlePick(cfg)}
                      className="flex flex-col items-start rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-accent/50"
                    >
                      <span className="text-sm font-medium">{cfg.label}</span>
                      <span className="text-xs text-muted-foreground mt-0.5">
                        {cfg.description}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
