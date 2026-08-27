import { AgentToolError } from "./errors";

const MAX_FUTURE_YEARS = 1;

export function rejectPastDate(isoString: string, label = "date"): void {
  const parsed = Date.parse(isoString);
  if (Number.isNaN(parsed)) {
    throw new AgentToolError(`Invalid ${label}: "${isoString}" is not a valid date/time. Use ISO 8601 format (e.g. 2026-08-21T15:00:00).`);
  }
  const now = Date.now();
  if (parsed < now) {
    throw new AgentToolError(`That ${label} is in the past. Did you mean a different day?`);
  }
  const maxFuture = now + MAX_FUTURE_YEARS * 365 * 24 * 60 * 60 * 1000;
  if (parsed > maxFuture) {
    throw new AgentToolError(`That ${label} is more than ${MAX_FUTURE_YEARS} year in the future. Please choose a closer date.`);
  }
}
