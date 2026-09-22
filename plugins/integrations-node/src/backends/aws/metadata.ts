import {
  getAwsOperationMetadata,
  listAwsServices,
  type AwsServiceMetadata,
  type AwsServiceProtocol,
} from '@roadiehq/types';
import type { PaginationConfig } from '../http';

export interface AwsServiceRequestDefaults {
  protocol: AwsServiceProtocol;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  headers?: Record<string, string>;
  body?: string;
  hostname?: string;
  signingRegion?: string;
  arrayExpression: string;
  objectIdExpression: string;
  pagination?: PaginationConfig;
}

export function listAwsServiceMetadata(): AwsServiceMetadata[] {
  return listAwsServices();
}

export function getAwsServiceRequestDefaults(
  service: string | undefined,
  operation: string | undefined,
): AwsServiceRequestDefaults | undefined {
  const metadata = getAwsOperationMetadata(service, operation);
  if (!metadata) {
    return undefined;
  }
  return {
    protocol: metadata.protocol,
    method: metadata.method,
    path: metadata.path,
    headers: metadata.headers,
    body: metadata.body,
    hostname: metadata.hostname,
    signingRegion: metadata.signingRegion,
    arrayExpression: metadata.arrayExpression,
    objectIdExpression: metadata.objectIdExpression,
    pagination: metadata.pagination as PaginationConfig | undefined,
  };
}
