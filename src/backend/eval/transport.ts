/**
 * Gemini is called only through an operator-supplied HTTPS endpoint.
 * The consumer Gemini API host is refused: this product needs a BAA endpoint.
 * The transport returns text to the runner. The runner discards that text after scoring.
 */
export interface EvalTransport {
  readonly modelId: string;
  readonly temperature: number;
  complete(prompt: string): Promise<string>;
}

const BLOCKED_HOSTS = new Set(["generativelanguage.googleapis.com", "ai.google.dev"]);

export interface GeminiEvalConfig {
  endpoint: string;
  apiKey: string;
  modelId: string;
  temperature: number;
}

export function assertEvalEndpoint(endpoint: string): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("GEMINI_EVAL_ENDPOINT is not a URL");
  }
  if (url.protocol !== "https:") throw new Error("GEMINI_EVAL_ENDPOINT must be https");
  if (BLOCKED_HOSTS.has(url.hostname)) {
    throw new Error("GEMINI_EVAL_ENDPOINT must be a BAA endpoint, not the consumer Gemini API");
  }
  return url;
}

export function createGeminiTransport(config: GeminiEvalConfig): EvalTransport {
  const url = assertEvalEndpoint(config.endpoint);
  if (!config.apiKey) throw new Error("GEMINI_EVAL_API_KEY is empty");
  if (!config.modelId) throw new Error("GEMINI_EVAL_MODEL is empty");

  return {
    modelId: config.modelId,
    temperature: config.temperature,
    async complete(prompt: string): Promise<string> {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: config.temperature },
        }),
      });
      if (!response.ok) {
        throw new Error(`Gemini eval request failed with HTTP ${response.status}`);
      }
      const body = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text =
        body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
      if (!text) throw new Error("Gemini eval response had no text");
      return text;
    },
  };
}
