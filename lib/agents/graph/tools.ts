import { tool, type DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { tools, type AgentToolCtx } from "@/lib/agents/registry";
import { buildCaptureTools } from "@/lib/automations/capture-tool";

type ToolParametersSchema = z.ZodObject<Record<string, z.ZodTypeAny>>;

export async function buildLangChainTools(
  enabledTools: string[],
  ctx: AgentToolCtx,
  agentId?: string | null,
): Promise<DynamicStructuredTool[]> {
  const result: DynamicStructuredTool[] = [];

  for (const [name, def] of Object.entries(tools)) {
    if (!enabledTools.includes(name)) continue;

    result.push(
      tool(
        async (args: Record<string, unknown>) => {
          return await def.execute(ctx, args);
        },
        {
          name,
          description: def.description,
          schema: def.parameters as ToolParametersSchema,
        },
      ),
    );
  }

  // ai_capture automations expose a dynamic capture_<id> tool per active run.
  const captureTools = await buildCaptureTools(ctx.tenantId, agentId);
  for (const def of captureTools) {
    result.push(
      tool(
        async (args: Record<string, unknown>) => {
          return await def.execute(ctx, args);
        },
        {
          name: def.name,
          description: def.description,
          schema: def.parameters as ToolParametersSchema,
        },
      ),
    );
  }

  return result;
}