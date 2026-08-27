interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const PRICING: Record<string, ModelPricing> = {
  "gemini-3.7-flash":          { inputPerMillion: 0.75,  outputPerMillion: 3.75 },
  "gemini-3.6-flash":          { inputPerMillion: 1.50,  outputPerMillion: 7.50 },
  "gemini-3.5-flash":          { inputPerMillion: 1.50,  outputPerMillion: 9.00 },
  "gemini-3.5-flash-lite":     { inputPerMillion: 0.30,  outputPerMillion: 2.50 },
  "gemini-3.1-pro":            { inputPerMillion: 2.00,  outputPerMillion: 12.00 },
  "gemini-3.1-flash-lite":     { inputPerMillion: 0.25,  outputPerMillion: 1.50 },
  "gemini-3-flash":            { inputPerMillion: 0.50,  outputPerMillion: 3.00 },
  "gemini-2.5-pro":            { inputPerMillion: 1.25,  outputPerMillion: 10.00 },
  "gemini-2.5-flash":          { inputPerMillion: 0.30,  outputPerMillion: 2.50 },
  "gemini-2.5-flash-lite":     { inputPerMillion: 0.10,  outputPerMillion: 0.40 },
  "gemini-2.0-flash":          { inputPerMillion: 0.10,  outputPerMillion: 0.40 },
  "gemini-2.0-flash-lite":     { inputPerMillion: 0.075, outputPerMillion: 0.30 },
};

const FALLBACK: ModelPricing = { inputPerMillion: 0.30, outputPerMillion: 2.50 };

function resolvePricing(modelName: string): ModelPricing {
  const normalised = modelName.toLowerCase();
  if (PRICING[normalised]) return PRICING[normalised];
  for (const [key, val] of Object.entries(PRICING)) {
    if (normalised.startsWith(key)) return val;
  }
  return FALLBACK;
}

export function calculateCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = resolvePricing(modelName);
  const inputCost = (inputTokens / 1_000_000) * p.inputPerMillion;
  const outputCost = (outputTokens / 1_000_000) * p.outputPerMillion;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}
