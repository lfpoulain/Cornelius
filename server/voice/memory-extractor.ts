import { Mistral } from '@mistralai/mistralai';
import type { MemoryExtractor } from '../memory.js';
import { memoryExtractionInstructions } from '../memory-extractor.js';
import schema from '../../schemas/memory-changes.schema.json' with { type: 'json' };

export function createMistralMemoryExtractor(apiKey: string): MemoryExtractor {
  const client = new Mistral({ apiKey, timeoutMs: 55_000 });
  return async (input, signal) => {
    const response = await client.chat.complete(
      {
        model: 'mistral-small-latest',
        messages: [
          { role: 'system', content: memoryExtractionInstructions },
          { role: 'user', content: JSON.stringify(input) },
        ],
        responseFormat: {
          type: 'json_schema',
          jsonSchema: { name: 'memory_changes', schemaDefinition: schema, strict: true },
        },
        maxTokens: 6000,
      },
      { signal },
    );
    const choice = response.choices?.[0];
    const content = choice?.message?.content;
    if (choice?.finishReason !== 'stop' || typeof content !== 'string')
      throw new Error('Extraction mémoire Mistral incomplète.');
    return JSON.parse(content) as unknown;
  };
}
