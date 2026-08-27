"use client";

import { useState } from "react";
import { Plus, Trash2, HelpCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  FIELD_TYPES_CONFIG,
  SUGGESTED_ROLES,
  type SchemaField,
  type SchemaFieldOption,
  type SchemaFieldType,
  type SemanticRole,
} from "@/lib/booking/schema-types";

interface SchemaFieldEditorProps {
  field: SchemaField | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updatedField: SchemaField) => void;
}

export function SchemaFieldEditor({
  field,
  open,
  onOpenChange,
  onSave,
}: SchemaFieldEditorProps) {
  if (!field) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-lg overflow-y-auto flex flex-col justify-between">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Configure Field
            <Badge variant="outline" className="font-mono text-xs">
              {field.id}
            </Badge>
          </SheetTitle>
          <SheetDescription>
            Customize field requirements, semantic role, and AI conversation behavior.
          </SheetDescription>
        </SheetHeader>

        <EditorForm field={field} onSave={(f) => { onSave(f); onOpenChange(false); }} onCancel={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  );
}

function EditorForm({
  field,
  onSave,
  onCancel,
}: {
  field: SchemaField;
  onSave: (field: SchemaField) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(field.label);
  const [id, setId] = useState(field.id);
  const [type, setType] = useState<SchemaFieldType>(field.type);
  const [required, setRequired] = useState(field.required);
  const [role, setRole] = useState<SemanticRole>(field.role);
  const [placeholder, setPlaceholder] = useState(field.placeholder ?? "");

  // Options for select/radio
  const [options, setOptions] = useState<SchemaFieldOption[]>(field.options ?? []);
  const [newOptionLabel, setNewOptionLabel] = useState("");

  // AI settings
  const [question, setQuestion] = useState(field.ai?.question ?? "");
  const [confirmation, setConfirmation] = useState(field.ai?.confirmation ?? "");
  const [extractionHints, setExtractionHints] = useState(field.ai?.extraction_hints ?? "");
  const [retryPrompt, setRetryPrompt] = useState(field.ai?.retry_prompt ?? "");
  const [examplesText, setExamplesText] = useState((field.ai?.examples ?? []).join("\n"));

  const needsOptions = ["select", "multi_select", "radio"].includes(type);

  function handleAddOption() {
    if (!newOptionLabel.trim()) return;
    const val = newOptionLabel.trim().toLowerCase().replace(/\s+/g, "_");
    setOptions([...options, { label: newOptionLabel.trim(), value: val }]);
    setNewOptionLabel("");
  }

  function handleRemoveOption(index: number) {
    setOptions(options.filter((_, i) => i !== index));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const updated: SchemaField = {
      ...field,
      id: id.trim() || field.id,
      label: label.trim() || field.label,
      type,
      required,
      role,
      placeholder: placeholder.trim() || undefined,
      options: needsOptions ? options : undefined,
      ai: {
        question: question.trim() || undefined,
        confirmation: confirmation.trim() || undefined,
        extraction_hints: extractionHints.trim() || undefined,
        retry_prompt: retryPrompt.trim() || undefined,
        examples: examplesText.split("\n").map((s) => s.trim()).filter(Boolean),
      },
    };
    onSave(updated);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 my-4 flex-1">
      <Tabs defaultValue="basic" className="w-full">
        <TabsList className="grid grid-cols-2 w-full">
          <TabsTrigger value="basic">Field Settings</TabsTrigger>
          <TabsTrigger value="ai" className="flex items-center gap-1">
            <Sparkles className="size-3.5" />
            AI Conversation
          </TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-4 pt-3">
          <div className="space-y-2">
            <Label htmlFor="field-label">Label</Label>
            <Input
              id="field-label"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                if (!field.id || field.id === label.toLowerCase().replace(/\s+/g, "_")) {
                  setId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"));
                }
              }}
              placeholder="e.g., Preferred Date"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="field-id" className="flex items-center gap-1.5">
              Field ID
              <span className="text-xs text-muted-foreground font-normal">(stored in booking data)</span>
            </Label>
            <Input
              id="field-id"
              value={id}
              onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
              placeholder="e.g., preferred_date"
              className="font-mono text-sm"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={(val) => setType(val as SchemaFieldType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["Basic", "Date & Time", "Selection", "Booking"].map((category) => (
                  <SelectGroup key={category}>
                    <SelectLabel>{category}</SelectLabel>
                    {FIELD_TYPES_CONFIG.filter((f) => f.category === category).map((cfg) => (
                      <SelectItem key={cfg.type} value={cfg.type}>
                        {cfg.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Semantic Role</Label>
            <Select value={role} onValueChange={(val) => setRole(val as SemanticRole)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["Customer", "Booking", "Resource", "Capacity", "Other"].map((cat) => (
                  <SelectGroup key={cat}>
                    <SelectLabel>{cat}</SelectLabel>
                    {SUGGESTED_ROLES.filter((r) => r.category === cat).map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label} ({r.value})
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Tells the booking engine how to interpret this field during AI collection and validation.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label className="text-sm font-medium">Required Field</Label>
              <p className="text-xs text-muted-foreground">
                Customer must provide this value to complete the booking.
              </p>
            </div>
            <Switch checked={required} onCheckedChange={setRequired} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="field-placeholder">Placeholder / Help Text</Label>
            <Input
              id="field-placeholder"
              value={placeholder}
              onChange={(e) => setPlaceholder(e.target.value)}
              placeholder="e.g. Choose your appointment date"
            />
          </div>

          {needsOptions && (
            <div className="space-y-3 pt-2 border-t">
              <Label>Selectable Options</Label>
              <div className="flex gap-2">
                <Input
                  value={newOptionLabel}
                  onChange={(e) => setNewOptionLabel(e.target.value)}
                  placeholder="Option name..."
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddOption();
                    }
                  }}
                />
                <Button type="button" variant="outline" onClick={handleAddOption}>
                  <Plus className="size-4" />
                  Add
                </Button>
              </div>

              {options.length > 0 ? (
                <div className="space-y-1.5">
                  {options.map((opt, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded-md border px-3 py-1.5 text-sm"
                    >
                      <span>{opt.label}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6 text-destructive"
                        onClick={() => handleRemoveOption(idx)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">No options added yet.</p>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="ai" className="space-y-4 pt-3">
          <div className="rounded-lg bg-primary/5 p-3 text-xs text-primary border border-primary/20 flex gap-2">
            <Sparkles className="size-4 shrink-0 mt-0.5" />
            <p>
              The WhatsApp AI Agent will use these prompts to ask for and confirm this field during conversation.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-question">Question to Ask Customer</Label>
            <Textarea
              id="ai-question"
              rows={2}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={`e.g. What ${label.toLowerCase()} would you prefer?`}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-confirmation">Confirmation Message</Label>
            <Textarea
              id="ai-confirmation"
              rows={2}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder="e.g. You selected {{value}}. Is that correct?"
            />
            <p className="text-xs text-muted-foreground">Use {"{{value}}"} as a placeholder for the extracted answer.</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-hints">Extraction Instructions / Hints</Label>
            <Input
              id="ai-hints"
              value={extractionHints}
              onChange={(e) => setExtractionHints(e.target.value)}
              placeholder="e.g. Look for dates mentioned in relative or absolute terms"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-examples">Example Valid Answers (one per line)</Label>
            <Textarea
              id="ai-examples"
              rows={3}
              value={examplesText}
              onChange={(e) => setExamplesText(e.target.value)}
              placeholder={"Tomorrow\nNext Monday\nAugust 20th"}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="ai-retry">Retry Question (if misunderstood)</Label>
            <Input
              id="ai-retry"
              value={retryPrompt}
              onChange={(e) => setRetryPrompt(e.target.value)}
              placeholder="I didn't quite catch that date. Could you specify another date?"
            />
          </div>
        </TabsContent>
      </Tabs>

      <SheetFooter className="gap-2 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">Save Changes</Button>
      </SheetFooter>
    </form>
  );
}
