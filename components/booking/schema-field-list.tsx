"use client";

import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SchemaFieldPicker } from "./schema-field-picker";
import { SchemaFieldEditor } from "./schema-field-editor";
import type { SchemaField } from "@/lib/booking/schema-types";

interface SchemaFieldListProps {
  fields: SchemaField[];
  onChange: (fields: SchemaField[]) => void;
}

export function SchemaFieldList({ fields, onChange }: SchemaFieldListProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editingField, setEditingField] = useState<SchemaField | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  function handleAddField(field: SchemaField) {
    let newId = field.id;
    let count = 1;
    while (fields.some((f) => f.id === newId)) {
      newId = `${field.id}_${count++}`;
    }
    const createdField = { ...field, id: newId };
    onChange([...fields, createdField]);
    setEditingField(createdField);
    setEditorOpen(true);
  }

  function handleUpdateField(updated: SchemaField) {
    onChange(fields.map((f) => (f.id === editingField?.id ? updated : f)));
  }

  function handleRemoveField(id: string) {
    onChange(fields.filter((f) => f.id !== id));
  }

  function handleMove(index: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= fields.length) return;
    const copy = [...fields];
    const temp = copy[index];
    copy[index] = copy[targetIndex];
    copy[targetIndex] = temp;
    onChange(copy);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Booking Requirements</h3>
          <p className="text-sm text-muted-foreground">
            Define what information is needed from the customer to book this service.
          </p>
        </div>
        <Button onClick={() => setPickerOpen(true)} size="sm">
          <Plus className="size-4" />
          Add Requirement Field
        </Button>
      </div>

      {fields.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center p-8 text-center">
            <Sparkles className="size-8 text-muted-foreground/60 mb-2" />
            <p className="font-medium text-sm">No booking requirements configured</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Add fields like Date, Time, Customer Name, Phone, or specific questions needed for this booking.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => setPickerOpen(true)}
            >
              <Plus className="size-4" />
              Add First Field
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {fields.map((field, idx) => (
            <div
              key={field.id}
              className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 shadow-sm transition-all hover:border-primary/40"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex flex-col gap-0.5 text-muted-foreground">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-5 rounded"
                    disabled={idx === 0}
                    onClick={() => handleMove(idx, "up")}
                  >
                    <ArrowUp className="size-3" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-5 rounded"
                    disabled={idx === fields.length - 1}
                    onClick={() => handleMove(idx, "down")}
                  >
                    <ArrowDown className="size-3" />
                  </Button>
                </div>

                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{field.label}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {field.id}
                    </Badge>
                    <Badge variant={field.required ? "default" : "secondary"} className="text-[10px]">
                      {field.required ? "Required" : "Optional"}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px]">
                      Role: {field.role}
                    </Badge>
                  </div>
                  {field.ai?.question ? (
                    <p className="text-xs text-muted-foreground truncate mt-0.5 flex items-center gap-1">
                      <Sparkles className="size-3 text-primary/70 shrink-0" />
                      &quot;{field.ai.question}&quot;
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  onClick={() => {
                    setEditingField(field);
                    setEditorOpen(true);
                  }}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-destructive"
                  onClick={() => handleRemoveField(field.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <SchemaFieldPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelectType={handleAddField}
      />

      <SchemaFieldEditor
        field={editingField}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSave={handleUpdateField}
      />
    </div>
  );
}
