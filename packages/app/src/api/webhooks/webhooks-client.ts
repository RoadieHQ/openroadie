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
import { ResponseError } from '../infrastructure/errors';
import type { WorkspaceOwnershipFields } from '../workspace-scope';

export interface WebhookSubscriptionView extends WorkspaceOwnershipFields {
  id: string;
  url: string;
  filters: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookTokenSummaryView extends WorkspaceOwnershipFields {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export class WebhooksClient {
  constructor(
    private baseUrl: string,
    private fetch: typeof globalThis.fetch,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetch(`${this.baseUrl}${path}`, init);
    if (!response.ok) {
      throw await ResponseError.fromResponse(response);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }

  async listSubscriptions(): Promise<{ items: WebhookSubscriptionView[] }> {
    return this.request('/subscriptions');
  }

  async deleteSubscription(id: string): Promise<void> {
    return this.request(`/subscriptions/${id}`, { method: 'DELETE' });
  }

  async listTokens(): Promise<{ items: WebhookTokenSummaryView[] }> {
    return this.request('/tokens');
  }

  async createToken(
    label: string,
  ): Promise<WebhookTokenSummaryView & { token: string }> {
    return this.request('/tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    });
  }

  async deleteToken(id: string): Promise<void> {
    return this.request(`/tokens/${id}`, { method: 'DELETE' });
  }
}
