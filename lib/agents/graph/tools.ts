import { tool, type DynamicStructuredTool } from "@langchain/core/tools";
import { tools, type AgentToolCtx } from "@/lib/agents/registry";

export function buildLangChainTools(
  enabledTools: string[],
  ctx: AgentToolCtx,
): DynamicStructuredTool[] {
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
          schema: def.parameters as any,
        },
      ),
    );
  }

  return result;
}
