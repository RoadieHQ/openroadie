/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, resolve, sep } from 'path';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

// Credential-bearing body fields differ between record (real secret) and
// replay (dummy secret), so they must not enter the key or oauth token
// exchanges would 404 on replay. Stripping them leaves an oauth body empty
// (→ URL-keyed, stable) while a GraphQL body keeps its `query` (→ distinct
// per operation). Mirrors the response secret-masking philosophy.
const CREDENTIAL_BODY_KEYS = new Set([
  'client_id',
  'client_secret',
  'grant_type',
  'audience',
  'scope',
  'assertion',
  'code',
  'username',
  'password',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
]);

// Canonical JSON: credential fields dropped, object keys sorted recursively so
// a request body hashes the same regardless of property order or secret value.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !CREDENTIAL_BODY_KEYS.has(k))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonicalize(v)]),
    );
  }
  return value;
}

// Empty or credential-only bodies contribute nothing; a body with real content
// (e.g. a GraphQL query) yields a short stable discriminator so same-URL POSTs
// don't collide on one fixture.
function bodySlug(body: unknown): string {
  if (body === undefined || body === null || body === '') {
    return '';
  }
  const canonical = JSON.stringify(canonicalize(body));
  if (canonical === '{}' || canonical === '""' || canonical === 'null') {
    return '';
  }
  return `__b${createHash('sha256').update(canonical).digest('hex').slice(0, 12)}`;
}

export interface StoredResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export interface FixtureStorage {
  get(key: string): Promise<StoredResponse | undefined>;
}

/**
 * Builds the canonical storage key for a recorded integration response.
 * Query parameters are sorted so key lookup is order-insensitive, and the
 * result stays a valid, human-browsable filesystem path / S3 key.
 */
export function fixtureKey(
  integration: string,
  method: string,
  path: string,
  queryString: string,
  body?: unknown,
): string {
  const cleanPath = path.replace(/^\/+|\/+$/g, '');
  const params = [...new URLSearchParams(queryString).entries()]
    .sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const querySlug = params
    ? `__${params.replace(/[^a-zA-Z0-9=&._-]/g, '_')}`
    : '';
  return `${integration}/${method.toUpperCase()}/${cleanPath}${querySlug}${bodySlug(body)}.json`;
}

export class FsStorage implements FixtureStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private resolveKey(key: string): string {
    const path = resolve(this.root, key);
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new Error(`Fixture key escapes storage root: ${key}`);
    }
    return path;
  }

  async get(key: string): Promise<StoredResponse | undefined> {
    const path = this.resolveKey(key);
    try {
      return JSON.parse(await readFile(path, 'utf8')) as StoredResponse;
    } catch (e: unknown) {
      if (e instanceof Error && 'code' in e && e.code === 'ENOENT') {
        return undefined;
      }
      throw e;
    }
  }

  async put(key: string, response: StoredResponse): Promise<void> {
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(response, null, 2)}\n`, 'utf8');
  }
}

export class S3Storage implements FixtureStorage {
  constructor(
    private readonly bucket: string,
    private readonly prefix: string = '',
    private readonly client: S3Client = new S3Client({}),
  ) {}

  private objectKey(key: string): string {
    return this.prefix ? `${this.prefix.replace(/\/+$/, '')}/${key}` : key;
  }

  async get(key: string): Promise<StoredResponse | undefined> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
      );
      const raw = await result.Body?.transformToString();
      return raw ? (JSON.parse(raw) as StoredResponse) : undefined;
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'NoSuchKey') {
        return undefined;
      }
      throw e;
    }
  }

  async put(key: string, response: StoredResponse): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        Body: JSON.stringify(response, null, 2),
        ContentType: 'application/json',
      }),
    );
  }
}
