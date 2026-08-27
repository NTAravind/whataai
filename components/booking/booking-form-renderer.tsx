"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ResourceRow } from "@/lib/api/types";
import type { SchemaField } from "@/lib/booking/schema-types";

interface BookingFormRendererProps {
  fields: SchemaField[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  resources?: ResourceRow[];
}

export function BookingFormRenderer({
  fields,
  values,
  onChange,
  resources = [],
}: BookingFormRendererProps) {
  function setValue(id: string, val: unknown) {
    onChange({ ...values, [id]: val });
  }

  if (fields.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic py-2">
        No dynamic requirement fields configured for this service.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {fields.map((field) => {
        const val = values[field.id] ?? "";

        // Resource Selector field
        if (field.type === "resource") {
          return (
            <div key={field.id} className="space-y-2">
              <Label htmlFor={field.id} className="flex items-center gap-1">
                {field.label}
                {field.required && <span className="text-destructive">*</span>}
              </Label>
              <Select
                value={String(val)}
                onValueChange={(v) => setValue(field.id, v)}
              >
                <SelectTrigger id={field.id}>
                  <SelectValue placeholder={field.placeholder ?? "Select a resource..."} />
                </SelectTrigger>
                <SelectContent>
                  {resources.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name} ({r.type})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        }

        // Dropdown Select
        if (field.type === "select" || field.type === "radio") {
          return (
            <div key={field.id} className="space-y-2">
              <Label htmlFor={field.id} className="flex items-center gap-1">
                {field.label}
                {field.required && <span className="text-destructive">*</span>}
              </Label>
              <Select
                value={String(val)}
                onValueChange={(v) => setValue(field.id, v)}
              >
                <SelectTrigger id={field.id}>
                  <SelectValue placeholder={field.placeholder ?? "Select an option..."} />
                </SelectTrigger>
                <SelectContent>
                  {(field.options ?? []).map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        }

        // Long Text
        if (field.type === "long_text") {
          return (
            <div key={field.id} className="space-y-2">
              <Label htmlFor={field.id} className="flex items-center gap-1">
                {field.label}
                {field.required && <span className="text-destructive">*</span>}
              </Label>
              <Textarea
                id={field.id}
                rows={3}
                value={String(val)}
                onChange={(e) => setValue(field.id, e.target.value)}
                placeholder={field.placeholder}
              />
            </div>
          );
        }

        // Checkbox
        if (field.type === "checkbox") {
          return (
            <div key={field.id} className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor={field.id} className="cursor-pointer">
                {field.label}
              </Label>
              <Switch
                id={field.id}
                checked={Boolean(val)}
                onCheckedChange={(c) => setValue(field.id, c)}
              />
            </div>
          );
        }

        // Number / Participants / Guests
        if (field.type === "number" || field.type === "participants" || field.type === "guests") {
          return (
            <div key={field.id} className="space-y-2">
              <Label htmlFor={field.id} className="flex items-center gap-1">
                {field.label}
                {field.required && <span className="text-destructive">*</span>}
              </Label>
              <Input
                id={field.id}
                type="number"
                min="1"
                value={String(val)}
                onChange={(e) => setValue(field.id, e.target.valueAsNumber || e.target.value)}
                placeholder={field.placeholder ?? "1"}
              />
            </div>
          );
        }

        // Date
        if (field.type === "date") {
          return (
            <div key={field.id} className="space-y-2">
              <Label htmlFor={field.id} className="flex items-center gap-1">
                {field.label}
                {field.required && <span className="text-destructive">*</span>}
              </Label>
              <Input
                id={field.id}
                type="date"
                value={String(val)}
                onChange={(e) => setValue(field.id, e.target.value)}
              />
            </div>
          );
        }

        // Time
        if (field.type === "time") {
          return (
            <div key={field.id} className="space-y-2">
              <Label htmlFor={field.id} className="flex items-center gap-1">
                {field.label}
                {field.required && <span className="text-destructive">*</span>}
              </Label>
              <Input
                id={field.id}
                type="time"
                value={String(val)}
                onChange={(e) => setValue(field.id, e.target.value)}
              />
            </div>
          );
        }

        // Default Text / Phone / Email
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={field.id} className="flex items-center gap-1">
              {field.label}
              {field.required && <span className="text-destructive">*</span>}
            </Label>
            <Input
              id={field.id}
              type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
              value={String(val)}
              onChange={(e) => setValue(field.id, e.target.value)}
              placeholder={field.placeholder}
            />
          </div>
        );
      })}
    </div>
  );
}
