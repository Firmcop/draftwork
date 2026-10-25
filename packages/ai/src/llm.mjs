// A small client for Claude (the Anthropic Messages API) that asks for one structured answer: the model must reply
// by calling a single tool whose JSON schema we define, so what comes back is data, never free text to parse.
// Runs in Node and in browsers (with the user's own key). Anything with the same shape can stand in for it,
// which is how the tests run without a network.

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export class AIError extends Error {
  constructor(message, status) { super(message); this.name = 'AIError'; this.status = status; }
}

/**
 * createClaude({ apiKey, model?, fetch?, baseURL?, browser? }) → { ask({ system, content, tool, maxTokens }) → tool input }
 *   content: a string, or Messages API content blocks (text and images)
 *   tool:    { name, description, input_schema }
 */
export function createClaude({ apiKey, model = DEFAULT_MODEL, fetch: f = globalThis.fetch, baseURL = 'https://api.anthropic.com', browser = typeof window !== 'undefined' } = {}) {
  if (!apiKey) throw new AIError('An Anthropic API key is needed to use the AI features');
  return {
    model,
    async ask({ system, content, tool, maxTokens = 4096 }) {
      const headers = { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
      if (browser) headers['anthropic-dangerous-direct-browser-access'] = 'true';   // the user's own key, in their own browser
      let res;
      try {
        res = await f(baseURL + '/v1/messages', {
          method: 'POST', headers,
          body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }], tools: [tool], tool_choice: { type: 'tool', name: tool.name } }),
        });
      } catch (e) { throw new AIError('Could not reach the AI service: ' + e.message); }
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new AIError(body?.error?.message || `The AI service answered ${res.status}`, res.status);
      const call = body?.content?.find(b => b.type === 'tool_use' && b.name === tool.name);
      if (!call) throw new AIError('The AI did not give a usable answer');
      return call.input;
    },
  };
}
