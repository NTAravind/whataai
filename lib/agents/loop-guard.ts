export interface LoopGuardState {
  lastToolName?: string;
  lastArgsHash?: string;
  count?: number;
  lastAt?: string;
}

export function hashArgs(args: unknown): string {
  try {
    return JSON.stringify(args ?? {}).slice(0, 256);
  } catch {
    return "";
  }
}

export function shouldSuppressRepeat(state: LoopGuardState, toolName: string, args: unknown): boolean {
  const h = hashArgs(args);
  if (state.lastToolName === toolName && state.lastArgsHash === h && (state.count ?? 0) >= 2) {
    return true;
  }
  return false;
}

export function updateLoopGuard(state: LoopGuardState, toolName: string, args: unknown): LoopGuardState {
  const h = hashArgs(args);
  if (state.lastToolName === toolName && state.lastArgsHash === h) {
    return { ...state, count: (state.count ?? 1) + 1, lastAt: new Date().toISOString() };
  }
  return { lastToolName: toolName, lastArgsHash: h, count: 1, lastAt: new Date().toISOString() };
}
