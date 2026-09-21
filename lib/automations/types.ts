import { z } from "zod";

/**
 * Typed shapes for the automations feature. Everything stored in
 * `automations.steps` / `automations.trigger_config` is validated against
 * these on write (see lib/services/automations.ts).
 */

export const stepSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("api_call"),
    integrationId: z.string().uuid().optional(),
    // Absolute for raw-url steps; a path when the step targets an integration's
    // base_url. resolveTarget() validates the final URL at run time.
    url: z.string().optional(),
    method: z.enum(["GET", "POST", "PUT", "PATCH"]),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional(),
    responseType: z.enum(["json", "binary"]).default("json"),
    filename: z.string().optional(),
  }).refine((s) => s.integrationId || s.url, "either integrationId or url is required"),
  z.object({ type: z.literal("send_message"), text: z.string() }),
  z.object({ type: z.literal("send_template"), templateId: z.string() }),
  z.object({
    type: z.literal("send_document"),
    mediaId: z.string().optional(),
    url: z.string().optional(),
    filename: z.string().optional(),
  }).refine((s) => s.mediaId || s.url, "either mediaId or url is required"),
  z.object({ type: z.literal("tag_contact"), tag: z.string() }),
  z.object({ type: z.literal("wait"), seconds: z.number().min(1).max(3600) }),
]);

export const automationStepsSchema = z.array(stepSchema).min(1);
export type AutomationStep = z.infer<typeof stepSchema>;

export const captureFieldSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number"]),
  description: z.string(),
  required: z.boolean().default(true),
  saveToContact: z.boolean().default(false),
});

export type CaptureField = z.infer<typeof captureFieldSchema>;

export const triggerConfigSchema = z.union([
  z.object({ tool_name: z.string() }),
  z.object({ fields: z.array(captureFieldSchema).min(1) }),
  z.object({}).strict(),
]);

export type TriggerConfig = z.infer<typeof triggerConfigSchema>;