import { AIMessage } from "@langchain/core/messages";
import { END } from "@langchain/langgraph";
import { AgentState } from "./state";

export const MAX_TOOL_ITERATIONS = 6;

export function shouldContinue(state: typeof AgentState.State) {
  const lastMessage = state.messages[state.messages.length - 1];

  if (
    !(lastMessage instanceof AIMessage) ||
    !lastMessage.tool_calls?.length
  ) {
    return END;
  }

  return "tools";
}

/**
 * Once the tool-call limit is reached, make one final model call without any
 * tools available. Ending on the preceding AI tool-call message would leave
 * the customer with an empty response.
 */
export function nextAfterTools(state: typeof AgentState.State) {
  return state.iteration >= MAX_TOOL_ITERATIONS ? "final" : "agent";
}
