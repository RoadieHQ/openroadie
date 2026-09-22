import type {
  BackendType,
  RequestOptions,
  Integration,
  PageResult,
} from '../index';
import { buildHttpRequestOptions, deriveHttpDataKey } from './http';
import { buildAwsRequestOptions } from './aws';
import { deriveAwsDataKey } from '@roadiehq/types';

export interface IntegrationBackend {
  request(integration: Integration, options: RequestOptions): Promise<unknown>;
  requestPages(
    integration: Integration,
    options: RequestOptions,
  ): AsyncGenerator<PageResult>;
}

export { isHttpRequestOptions } from './http';
export {
  parseAwsRequestResourceOptions,
  parseAwsRequestPagesOptions,
} from './aws';

export function deriveDataKey(
  backendType: BackendType,
  config: Record<string, unknown>,
): string {
  switch (backendType) {
    case 'http':
      return deriveHttpDataKey(config);
    case 'aws':
      return deriveAwsDataKey(config);
    default:
      return 'data';
  }
}

export function buildRequestOptions(
  backendType: BackendType,
  config: Record<string, unknown>,
  signal?: AbortSignal,
): { objectIdExpression: string; requestOptions: RequestOptions } {
  switch (backendType) {
    case 'http':
      return buildHttpRequestOptions(config, signal);
    case 'aws':
      return buildAwsRequestOptions(config, signal);
    default:
      throw new Error(`Unsupported backend type: ${backendType}`);
  }
}
