import { Annotation } from "@langchain/langgraph";
import { BaseMessage } from "@langchain/core/messages";

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: (existing, update) => [...existing, ...update],
    default: () => [],
  }),
  iteration: Annotation<number>({
    reducer: (_, update) => update,
    default: () => 0,
  }),
  metadata: Annotation<{
    tenantId: string;
    conversationId: string;
    contactId: string;
    customerName?: string;
    agentId: string;
    modelName: string;
  }>({
    reducer: (_, update) => update,
    default: () => ({
      tenantId: "",
      conversationId: "",
      contactId: "",
      agentId: "",
      modelName: "",
    }),
  }),
});
