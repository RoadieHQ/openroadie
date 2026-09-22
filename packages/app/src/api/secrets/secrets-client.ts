import { ResponseError } from '../infrastructure/errors';

export enum SecretStatusType {
  Available = 'Available',
  Not_Set = 'Not Set',
}

export type Secret = {
  name: string;
  ref?: string;
  value: string;
  description: string;
  status: SecretStatusType;
  helpUrl?: string;
  isCustom?: boolean;
  createdAt?: string;
  lastModified?: string;
};

export type SecretMetadata = {
  name: string;
  description?: string;
  helpUrl?: string;
};

export type StorageMode = {
  mode: 'env' | 'dotenv' | 'scoped';
  readOnly: boolean;
  dotenvPath?: string;
  hiddenSecretRefs?: string[];
};

function isSecretAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof ResponseError &&
    error.statusCode === 400 &&
    /already exists|duplicate/i.test(error.message)
  );
}

export class SecretsSettingsClient {
  constructor(
    private baseUrl: string,
    private fetch: typeof globalThis.fetch,
  ) {}

  async getKeys(): Promise<Secret[]> {
    const response = await this.fetch(`${this.baseUrl}/keys`);
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    return response.json();
  }

  async getMetadata(): Promise<SecretMetadata[]> {
    const response = await this.fetch(`${this.baseUrl}/secret-metadata`);
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    return response.json();
  }

  async getSecret(secret: string): Promise<Secret> {
    const response = await this.fetch(
      `${
        this.baseUrl
      }/secret-value/${secret}?buster=${new Date().getMilliseconds()}`,
    );
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    return response.json();
  }

  async getSecretStatus(ref: string): Promise<{ exists: boolean }> {
    const response = await this.fetch(
      `${this.baseUrl}/secret-status/${encodeURIComponent(ref)}`,
    );
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    return response.json();
  }

  async getStorageMode(): Promise<StorageMode> {
    const response = await this.fetch(`${this.baseUrl}/storage-mode`);
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    return response.json();
  }

  async deleteSecret(secret: string): Promise<void> {
    const response = await this.fetch(
      `${this.baseUrl}/secret-value/${secret}`,
      { method: 'DELETE' },
    );
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
  }

  async deleteSecretMetadata(name: string): Promise<void> {
    const response = await this.fetch(
      `${this.baseUrl}/secret-metadata/${encodeURIComponent(name)}`,
      { method: 'DELETE' },
    );
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
  }

  async setSecret(name: string, value: string): Promise<void> {
    const response = await this.fetch(`${this.baseUrl}/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, value: value.trim() }),
    });
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
  }

  async addSecret(secret: {
    name: string;
    description?: string;
    helpUrl?: string;
    internalKeyName?: string;
  }): Promise<void> {
    const response = await this.fetch(`${this.baseUrl}/secret-metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(secret),
    });
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
  }

  async upsertSecret(secret: {
    name: string;
    value: string;
    description?: string;
    helpUrl?: string;
    internalKeyName?: string;
  }): Promise<void> {
    const { value, ...metadata } = secret;
    let metadataAlreadyExisted = false;
    try {
      await this.addSecret(metadata);
    } catch (error) {
      if (!isSecretAlreadyExistsError(error)) {
        throw error;
      }
      metadataAlreadyExisted = true;
    }
    await this.setSecret(secret.name, value);
    if (metadataAlreadyExisted) {
      const patch: {
        description?: string;
        helpUrl?: string;
        internalKeyName?: string;
      } = {};
      if ('description' in secret && secret.description !== undefined) {
        patch.description = secret.description;
      }
      if ('helpUrl' in secret && secret.helpUrl !== undefined) {
        patch.helpUrl = secret.helpUrl;
      }
      if (
        'internalKeyName' in secret &&
        secret.internalKeyName !== undefined &&
        secret.internalKeyName !== secret.name
      ) {
        patch.internalKeyName = secret.internalKeyName;
      }
      if (Object.keys(patch).length > 0) {
        await this.editSecret(secret.name, patch);
      }
    }
  }

  async editSecret(
    name: string,
    patch: {
      description?: string | null;
      helpUrl?: string | null;
      name?: string;
      internalKeyName?: string;
    },
  ): Promise<void> {
    const response = await this.fetch(
      `${this.baseUrl}/secret-metadata/${encodeURIComponent(name)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      },
    );
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
  }
}
