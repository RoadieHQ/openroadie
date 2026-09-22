import { JsonValue } from '@roadiehq/types';

export type JsonSchema = Record<string, JsonValue>;

export const MAX_ITEMS_TO_SAMPLE = 10000;

export type MergeStrategy = 'json' | 'variant';
