export const MEMORY_PROVIDERS = ['openai', 'mistral', 'custom'] as const;
export type MemoryProvider = (typeof MEMORY_PROVIDERS)[number];

export interface CustomProviderSettings {
  name: string;
  baseUrl: string;
  memoryModel: string;
  memoryProvider: MemoryProvider;
  memoryFallback: 'openai' | 'mistral';
}

export interface CustomProviderView extends CustomProviderSettings {
  keyConfigured: boolean;
  models: string[];
  ready: { memory: boolean };
}

export const DEFAULT_CUSTOM_PROVIDER: CustomProviderSettings = {
  name: 'Fournisseur personnalisé',
  baseUrl: '',
  memoryModel: '',
  memoryProvider: 'openai',
  memoryFallback: 'openai',
};

const model = (value: unknown) =>
  typeof value === 'string' && value.trim().length <= 160 && !/[\u0000-\u001f\u007f]/u.test(value);

export function validCustomProviderSettings(value: unknown): value is CustomProviderSettings {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  if (
    typeof item.name !== 'string' ||
    !item.name.trim() ||
    item.name.trim().length > 80 ||
    typeof item.baseUrl !== 'string' ||
    !model(item.memoryModel) ||
    !MEMORY_PROVIDERS.includes(item.memoryProvider as MemoryProvider) ||
    !['openai', 'mistral'].includes(String(item.memoryFallback))
  )
    return false;
  if (!item.baseUrl) return true;
  try {
    const url = new URL(item.baseUrl);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
