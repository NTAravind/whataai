type ORModel = {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  supported_parameters?: string[];
};

export type OpenRouterModelOption = {
  id: string;
  name: string;
  contextLength: number;
  /** USD per 1M tokens, converted from OpenRouter's per-token price. */
  inputPerMillion: number;
  outputPerMillion: number;
};

export async function fetchOpenRouterModels(opts?: {
  freeOnly?: boolean;
  toolsOnly?: boolean;
}): Promise<OpenRouterModelOption[]> {
  const { freeOnly = true, toolsOnly = true } = opts ?? {};
  const apiKey = process.env.OPENROUTER_API_KEY;

  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    next: { revalidate: 3600 }, // cache 1h in Next.js; remove if not needed
  });
  if (!res.ok) throw new Error(`OpenRouter models fetch failed: ${res.status}`);

  const { data } = (await res.json()) as { data: ORModel[] };

  return data
    .filter((m) => {
      const isFree =
        m.id.endsWith(":free") ||
        (Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0);
      const hasTools = m.supported_parameters?.includes("tools") ?? false;
      return (!freeOnly || isFree) && (!toolsOnly || hasTools);
    })
    .map((m) => {
      const prompt = Number(m.pricing.prompt);
      const completion = Number(m.pricing.completion);
      // Per-token prices like 0.0000008 don't survive * 1e6 exactly (0.7999999…),
      // and these values land in the registry as displayed prices.
      const perMillion = (value: number) =>
        Math.round((Number.isFinite(value) ? value : 0) * 1_000_000 * 1e6) / 1e6;
      return {
        id: m.id,
        name: m.name,
        contextLength: m.context_length,
        inputPerMillion: perMillion(prompt),
        outputPerMillion: perMillion(completion),
      };
    });
}
