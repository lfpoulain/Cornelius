import OpenAI from 'openai';
import { validators } from '../shared/validation.js';
import type { DatabaseSync } from 'node:sqlite';
import schema from '../schemas/memory-changes.schema.json' with { type: 'json' };
import {
  DEFAULT_CUSTOM_PROVIDER,
  type CustomProviderSettings,
  type CustomProviderView,
} from '../shared/custom-provider.js';
import { strictSchema } from './live/configuration.js';
import { memoryExtractionInstructions } from './memory-extractor.js';
import type { MemoryExtractor } from './memory.js';

export const customProviderMigration = `CREATE TABLE IF NOT EXISTS custom_provider_preferences (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT 'Fournisseur personnalisé',
  base_url TEXT NOT NULL DEFAULT '',
  memory_model TEXT NOT NULL DEFAULT '',
  memory_provider TEXT NOT NULL DEFAULT 'openai',
  memory_fallback TEXT NOT NULL DEFAULT 'openai'
) STRICT;
INSERT OR IGNORE INTO custom_provider_preferences (id, memory_provider) SELECT 1, provider FROM voice_provider_preferences;`;

export class CustomProviderRepository {
  private models: string[] = [];
  constructor(private readonly db: DatabaseSync) {}

  get(): CustomProviderSettings {
    const row = this.db.prepare('SELECT * FROM custom_provider_preferences WHERE id = 1').get() as
      Record<string, unknown> | undefined;
    if (!row) return { ...DEFAULT_CUSTOM_PROVIDER };
    return {
      name: String(row.name),
      baseUrl: String(row.base_url),
      memoryModel: String(row.memory_model),
      memoryProvider:
        row.memory_provider === 'custom' || row.memory_provider === 'mistral'
          ? row.memory_provider
          : 'openai',
      memoryFallback: row.memory_fallback === 'mistral' ? 'mistral' : 'openai',
    };
  }

  set(value: CustomProviderSettings): void {
    this.db
      .prepare(
        `UPDATE custom_provider_preferences SET
        name = ?, base_url = ?, memory_model = ?, memory_provider = ?, memory_fallback = ? WHERE id = 1`,
      )
      .run(
        value.name.trim(),
        value.baseUrl.replace(/\/+$/u, ''),
        value.memoryModel.trim(),
        value.memoryProvider,
        value.memoryFallback,
      );
  }

  view(keyConfigured: boolean): CustomProviderView {
    const value = this.get();
    return {
      ...value,
      keyConfigured,
      models: this.models,
      ready: {
        memory: keyConfigured && !!value.baseUrl && !!value.memoryModel,
      },
    };
  }

  async discover(apiKey: string): Promise<string[]> {
    const config = this.get();
    if (!config.baseUrl) throw new Error('Renseignez d’abord l’URL de base.');
    const client = new OpenAI({ apiKey, baseURL: config.baseUrl, timeout: 12_000, maxRetries: 0 });
    const page = await client.models.list();
    this.models = page.data
      .map((entry) => entry.id)
      .filter(Boolean)
      .sort();
    return this.models;
  }
}

export function createCompatibleMemoryExtractor(
  apiKey: string,
  baseURL: string,
  model: string,
  fetch?: typeof globalThis.fetch,
): MemoryExtractor {
  const client = new OpenAI({ apiKey, baseURL, timeout: 15_000, maxRetries: 0, fetch });
  return async (input, signal) => {
    try {
      const response = await client.responses.create(
        {
          model,
          store: false,
          max_output_tokens: 6000,
          instructions: memoryExtractionInstructions,
          input: JSON.stringify(input),
          text: {
            format: {
              type: 'json_schema',
              name: 'memory_changes',
              strict: true,
              schema: strictSchema(schema) as Record<string, unknown>,
            },
          },
        },
        { signal },
      );
      if (response.status === 'completed' && response.output_text)
        return parseProposal(response.output_text);
    } catch (error) {
      if (signal.aborted) throw error;
    }
    const completion = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: memoryExtractionInstructions },
          { role: 'user', content: JSON.stringify(input) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'memory_changes',
            strict: true,
            schema: strictSchema(schema) as Record<string, unknown>,
          },
        },
        max_tokens: 6000,
      },
      { signal },
    );
    const content = completion.choices[0]?.message.content;
    if (completion.choices[0]?.finish_reason !== 'stop' || !content)
      throw new Error('Extraction mémoire incomplète.');
    return parseProposal(content);
  };
}

function parseProposal(content: string): unknown {
  const proposal: unknown = JSON.parse(content);
  if (!validators.memoryChanges(proposal)) throw new Error('Proposition mémoire invalide.');
  return proposal;
}

export function withMemoryFallback(primary: MemoryExtractor, fallback: MemoryExtractor | null) {
  if (!fallback) return primary;
  return (async (input, signal) => {
    try {
      return await primary(input, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      return fallback(input, signal);
    }
  }) satisfies MemoryExtractor;
}
