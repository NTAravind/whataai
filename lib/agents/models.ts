export interface ModelOption {
  id: string;
  label: string;
  group: string;
  description?: string;
}

export const DEFAULT_MODEL = "gemini-3.1-flash-lite";

export const MODELS: ModelOption[] = [
  // Gemini 3.x
  { id: "gemini-3.7-flash", label: "Gemini 3.7 Flash", group: "Gemini 3.x", description: "Latest flash, fastest & most capable" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash", group: "Gemini 3.x" },
  { id: "gemini-3.5-flash", label: "Gemini 3.5 Flash", group: "Gemini 3.x" },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", group: "Gemini 3.x" },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)", group: "Gemini 3.x" },
  { id: "gemini-3.1-flash-lite-preview-06-17", label: "Gemini 3.1 Flash-Lite (preview)", group: "Gemini 3.x" },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", group: "Gemini 3.x", description: "Default — fast, low cost" },
  { id: "gemini-3-pro-preview", label: "Gemini 3 Pro (preview)", group: "Gemini 3.x" },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash (preview)", group: "Gemini 3.x" },
  // Gemini 2.x
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", group: "Gemini 2.x" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", group: "Gemini 2.x" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", group: "Gemini 2.x" },
  { id: "gemini-2.5-flash-lite-preview-06-17", label: "Gemini 2.5 Flash-Lite (preview)", group: "Gemini 2.x" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", group: "Gemini 2.x" },
];

export function modelOption(id: string | undefined | null): ModelOption | undefined {
  if (!id) return undefined;
  return MODELS.find((m) => m.id === id);
}

export function modelLabel(id: string | undefined | null): string {
  return modelOption(id)?.label ?? id ?? DEFAULT_MODEL;
}
