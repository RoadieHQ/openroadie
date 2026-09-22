/// <reference types="vite/client" />
import bundledConfig from '~app-config';

declare const __BACKEND_URL__: string;

export type RelationshipsSuggestionProducer = 'api' | 'ai';

export interface AppConfig {
  scope?: string;
  app: {
    title: string;
    baseUrl: string;
    roadieUrl?: string;
  };
  features?: {
    admin?: boolean;
    relationships?: boolean;
  };
  backend: {
    baseUrl: string;
    headers?: Record<string, string>;
  };
  auth?: {
    domain: string;
    clientId: string;
    audience: string;
    organization?: string;
  };
  organization?: {
    name: string;
  };
  relationships?: {
    suggestionProducer?: RelationshipsSuggestionProducer;
  };
  [key: string]: unknown;
}

export function resolveRelationshipsSuggestionProducer(
  config: AppConfig,
): RelationshipsSuggestionProducer {
  if (config.relationships?.suggestionProducer === 'ai') {
    return 'ai';
  }
  return 'api';
}

function loadRuntimeConfig(): AppConfig | null {
  const scripts = document.querySelectorAll('script[type="roadie/config"]');
  for (const el of scripts) {
    const content = el.textContent;
    if (content) {
      return JSON.parse(content) as AppConfig;
    }
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = new Map<string, unknown>(Object.entries(target));
  for (const [key, sourceValue] of Object.entries(source)) {
    const targetValue = result.get(key);
    if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
      result.set(key, deepMerge(targetValue, sourceValue));
    } else {
      result.set(key, sourceValue);
    }
  }
  return Object.fromEntries(result);
}

function loadBundledConfig(): AppConfig {
  let merged = bundledConfig as Record<string, unknown>;

  if (__BACKEND_URL__) {
    merged = deepMerge(merged, { backend: { baseUrl: __BACKEND_URL__ } });
  }

  return merged as AppConfig;
}

function normalizeAuthKey(config: AppConfig): AppConfig {
  if (!config.auth && (config as Record<string, unknown>).auth0) {
    const { auth0, ...rest } = config as AppConfig & {
      auth0: AppConfig['auth'];
    };
    return { ...rest, auth: auth0 };
  }
  return config;
}

export function loadConfig(): AppConfig {
  const runtimeConfig = loadRuntimeConfig();
  if (runtimeConfig) return normalizeAuthKey(runtimeConfig);
  return normalizeAuthKey(loadBundledConfig());
}
