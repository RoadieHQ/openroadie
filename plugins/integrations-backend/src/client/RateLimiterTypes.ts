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

export interface RateLimiterMetricsCollector {
  updateMetrics(
    integrationId: string,
    integrationName: string,
    metrics: {
      queueDepth: number;
      estimatedWaitTimeMs: number;
      availableTokens: number;
    },
  ): void;
  removeMetrics(integrationId: string, integrationName: string): void;
}

export type MetricsCollector = RateLimiterMetricsCollector;

export interface RateLimiterMetrics {
  availableTokens: number;
  queueDepth: number;
  estimatedWaitTimeMs: number;
}

export interface RateLimiter {
  acquire(timeoutMs?: number): Promise<void>;
  tryAcquire(): boolean;
  availableTokens(): number;
  backoff(): void;
  getMetrics(): RateLimiterMetrics;
  destroy(): Promise<void>;
}

export class AcquireTimeoutError extends Error {
  constructor(
    message: string,
    public readonly waitedMs: number,
    public readonly timeoutMs: number,
  ) {
    super(message);
    this.name = 'AcquireTimeoutError';
  }
}
