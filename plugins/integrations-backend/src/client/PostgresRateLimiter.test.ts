import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
  type Mocked,
} from 'vitest';

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

import { Knex } from 'knex';
import { PostgresRateLimiter } from './PostgresRateLimiter';
import { RateLimiterMetricsCollector } from './RateLimiterTypes';

describe('PostgresRateLimiter', () => {
  let mockTrx: any;
  let mockKnex: Knex;
  let mockMetricsCollector: Mocked<RateLimiterMetricsCollector>;

  const createMockKnex = (): Knex => {
    mockTrx = {
      where: vi.fn().mockReturnThis(),
      forUpdate: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      insert: vi.fn().mockResolvedValue([1]),
      update: vi.fn().mockResolvedValue(1),
      raw: vi.fn().mockResolvedValue({
        rows: [
          {
            integration_id: 'test-id',
            tokens_remaining: '5',
            last_refill_at: new Date(),
            updated_at: new Date(),
          },
        ],
      }),
    };

    const mockQueryBuilder = {
      where: vi.fn().mockReturnThis(),
      delete: vi.fn().mockResolvedValue(1),
    };

    const knexFn = vi.fn().mockReturnValue(mockQueryBuilder) as any;

    knexFn.transaction = vi.fn().mockImplementation(async (callback: any) => {
      const trxWithTable = (tableName: string) => {
        if (tableName === 'rate_limit_state') {
          return mockTrx;
        }
        return mockTrx;
      };
      Object.assign(trxWithTable, mockTrx);
      return callback(trxWithTable);
    });

    return knexFn as unknown as Knex;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockKnex = createMockKnex();
    mockMetricsCollector = {
      updateMetrics: vi.fn(),
      removeMetrics: vi.fn(),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      const limiter = new PostgresRateLimiter({
        knex: mockKnex,
        integrationId: 'test-id',
        integrationName: 'test-name',
        requestsPerSecond: 10,
      });

      expect(limiter.availableTokens()).toBe(10);
      expect(limiter.getMetrics()).toEqual({
        availableTokens: 10,
        queueDepth: 0,
        estimatedWaitTimeMs: 0,
      });
    });

    it('should use custom burst value when provided', () => {
      const limiter = new PostgresRateLimiter({
        knex: mockKnex,
        integrationId: 'test-id',
        integrationName: 'test-name',
        requestsPerSecond: 10,
        burst: 50,
      });

      expect(limiter.availableTokens()).toBe(50);
    });
  });

  describe('tryAcquire', () => {
    it('should return true and decrement local tokens when available', async () => {
      const limiter = new PostgresRateLimiter({
        knex: mockKnex,
        integrationId: 'test-id',
        integrationName: 'test-name',
        requestsPerSecond: 10,
      });

      await limiter.acquire();

      const initialTokens = limiter.availableTokens();
      const result = limiter.tryAcquire();

      expect(result).toBe(true);
      expect(limiter.availableTokens()).toBe(initialTokens - 1);
    });

    it('should return false when no local tokens available', () => {
      const limiter = new PostgresRateLimiter({
        knex: mockKnex,
        integrationId: 'test-id',
        integrationName: 'test-name',
        requestsPerSecond: 10,
      });

      const result = limiter.tryAcquire();

      expect(result).toBe(false);
    });

    it('should return false when destroyed', async () => {
      const limiter = new PostgresRateLimiter({
        knex: mockKnex,
        integrationId: 'test-id',
        integrationName: 'test-name',
        requestsPerSecond: 10,
      });

      await limiter.destroy();
      const result = limiter.tryAcquire();

      expect(result).toBe(false);
    });
  });

  describe('acquire', () => {
    it('should throw error when destroyed', async () => {
      const limiter = new PostgresRateLimiter({
        knex: mockKnex,
        integrationId: 'test-id',
        integrationName: 'test-name',
        requestsPerSecond: 10,
      });

      await limiter.destroy();

      await expect(limiter.acquire()).rejects.toThrow(
        'PostgresRateLimiter has been destroyed',
      );
    });

    it('should use local tokens first if available', async () => {
      const limiter = new PostgresRateLimiter({
        knex: mockKnex,
        integrationId: 'test-id',
        integrationName: 'test-name',
        requestsPerSecond: 10,
      });

      await limiter.acquire();

      const transactionCallCount = (mockKnex.transaction as Mock).mock.calls
        .length;

      await limiter.acquire();

      expect((mockKnex.transaction as Mock).mock.calls.length).toBe(
        transactionCallCount,
      );
    });

    it('should create new rate_limit_state row if none exists', async () => {
      mockTrx.first.mockResolvedValue(null);
      mockTrx.raw.mockResolvedValue({
        rows: [
          {
            integration_id: 'test-id',
            tokens_remaining: '5',
            last_refill_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const limiter = new PostgresRateLimiter({
        knex: mockKnex,
        integrationId: 'test-id',
        integrationName: 'test-name',
        requestsPerSecond: 10,
      });

      await limiter.acquire();

      expect(mockTrx.raw).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO rate_limit_state'),
        expect.any(Array),
      );
    });

    it('should update existing row when tokens are available', async () => {
      const existingRow = {
        integration_id: 'test-id',
        tokens_remaining: '10',
        last_refill_at: new Date(),
        updated_at: new Date(),
      };
      mockTrx.first.mockResolvedValue(existingRow);

      const limiter = new PostgresRateLimiter({
        knex: mockKnex,
        integrationId: 'test-id',
        integrationName: 'test-name',
        requestsPerSecond: 10,
      });

      await limiter.acquire();

      expect(mockTrx.update).toHaveBeenCalled();
    });

    it('should emit metrics when metricsCollector is provided', async () => {
      const limiter = new PostgresRateLimiter({
        knex: mockKnex,
        integrationId: 'test-id',
        integrationName: 'test-name',
        requestsPerSecond: 10,
        metricsCollector: mockMetricsCollector,
      });

      await limiter.acquire();

      expect(mockMetricsCollector.updateMetrics).toHaveBeenCalledWith(
        'test-id',
        'test-name',
        expect.objectContaining({
          queueDepth: 0,
          estimatedWaitTimeMs: 0,
        }),
      );
    });

    it('should retry and succeed when tokens become available', async () => {
      let callCount = 0;
      mockTrx.first.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve({
            integration_id: 'test-id',
            tokens_remaining: '0',
            last_refill_at: new Date(),
            updated_at: new Date(),
          });
        }
        return Promise.resolve({
          integration_id: 'test-id',
          tokens_remaining: '5',
          last_refill_at: new Date(),
          updated_at: new Date(),
        });
      });

      const limiter = new PostgresRateLimiter({
        knex: mockKnex,
        integrationId: 'test-id',
        integrationName: 'test-name',
        requestsPerSecond: 10,
      });

      const acquirePromise = limiter.acquire(5000);

      vi.advanceTimersByTime(250);

      await expect(acquirePromise).resolves.toBeUndefined();
    });

    it('should throw error when database operation fails', async () => {
      (mockKnex.transaction as Mock).mockRejectedValue(new Error('DB error'));

      const limiter = new PostgresRateLimiter({
        knex: mockKnex,
        integrationId: 'test-id',
        integrationName: 'test-name',
        requestsPerSecond: 10,
      });

      await expect(limiter.acquire()).rejects.toThrow(
        'Failed to acquire token from database',
      );
    });

    it('should handle race condition on first insert via ON CONFLICT', async () => {
      let firstCallToFirst = true;

      mockTrx.first.mockImplementation(() => {
        if (firstCallToFirst) {
          firstCallToFirst = false;
          return Promise.resolve(null);
        }
        return Promise.resolve({
          integration_id: 'test-id',
          tokens_remaining: '5',
          last_refill_at: new Date(),
          updated_at: new Date(),
        });
      });

      mockTrx.raw.mockResolvedValue({ rows: [] });

      const limiter = new PostgresRateLimiter({
        knex: mockKnex,
        integrationId: 'test-id',
        integrationName: 'test-name',
        requestsPerSecond: 10,
      });

      await limiter.acquire();

      expect(mockTrx.raw).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT'),
        expect.any(Array),
      );
      expect(mockTrx.first).toHaveBeenCalledTimes(2);
      expect(mockTrx.update).toHaveBeenCalled();
    });
  });

  describe('backoff', () => {
    it('should clear local tokens', async () => {
      const limiter = new PostgresRateLimiter({
        knex: mockKnex,
        integrationId: 'test-id',
        integrationName: 'test-name',
        requestsPerSecond: 10,
        batchSize: 5,
      });

      await limiter.acquire();
      const tokensAfterAcquire = limiter.availableTokens();

      limiter.backoff();

      expect(limiter.availableTokens()).toBeLessThan(tokensAfterAcquire);
    });
  });

  describe('destroy', () => {
    it('should set destroyed flag', async () => {
      const limiter = new PostgresRateLimiter({
        knex: mockKnex,
        integrationId: 'test-id',
        integrationName: 'test-name',
        requestsPerSecond: 10,
      });

      await limiter.destroy();

      expect(limiter.tryAcquire()).toBe(false);
      await expect(limiter.acquire()).rejects.toThrow(
        'PostgresRateLimiter has been destroyed',
      );
    });

    it('should remove metrics when metricsCollector is provided', async () => {
      const limiter = new PostgresRateLimiter({
        knex: mockKnex,
        integrationId: 'test-id',
        integrationName: 'test-name',
        requestsPerSecond: 10,
        metricsCollector: mockMetricsCollector,
      });

      await limiter.destroy();

      expect(mockMetricsCollector.removeMetrics).toHaveBeenCalledWith(
        'test-id',
        'test-name',
      );
    });

    it('should delete rate_limit_state from database', async () => {
      const mockDelete = vi.fn().mockResolvedValue(1);
      const mockWhere = vi.fn().mockReturnValue({ delete: mockDelete });
      const localMockKnex = vi
        .fn()
        .mockReturnValue({ where: mockWhere }) as any;
      localMockKnex.transaction = vi.fn();

      const limiter = new PostgresRateLimiter({
        knex: localMockKnex as unknown as Knex,
        integrationId: 'test-id',
        integrationName: 'test-name',
        requestsPerSecond: 10,
      });

      await limiter.destroy();

      expect(localMockKnex).toHaveBeenCalledWith('rate_limit_state');
      expect(mockWhere).toHaveBeenCalledWith('integration_id', 'test-id');
      expect(mockDelete).toHaveBeenCalled();
    });
  });

  describe('token refill logic', () => {
    it('should cap tokens at burst limit', async () => {
      const veryOldDate = new Date(Date.now() - 100000);
      mockTrx.first.mockResolvedValue({
        integration_id: 'test-id',
        tokens_remaining: '0',
        last_refill_at: veryOldDate,
        updated_at: veryOldDate,
      });

      const limiter = new PostgresRateLimiter({
        knex: mockKnex,
        integrationId: 'test-id',
        integrationName: 'test-name',
        requestsPerSecond: 10,
        burst: 20,
      });

      await limiter.acquire();

      expect(mockTrx.update).toHaveBeenCalled();
      const updateCall = mockTrx.update.mock.calls[0][0];
      expect(parseFloat(updateCall.tokens_remaining)).toBeLessThanOrEqual(20);
    });
  });

  describe('batch reservation', () => {
    it('should reserve batch of tokens on acquire', async () => {
      mockTrx.first.mockResolvedValue(null);
      mockTrx.raw.mockResolvedValue({
        rows: [
          {
            integration_id: 'test-id',
            tokens_remaining: '5',
            last_refill_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const limiter = new PostgresRateLimiter({
        knex: mockKnex,
        integrationId: 'test-id',
        integrationName: 'test-name',
        requestsPerSecond: 10,
        batchSize: 5,
      });

      await limiter.acquire();

      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(false);
    });

    it('should respect custom batchSize', async () => {
      mockTrx.first.mockResolvedValue(null);
      mockTrx.raw.mockResolvedValue({
        rows: [
          {
            integration_id: 'test-id',
            tokens_remaining: '17',
            last_refill_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const limiter = new PostgresRateLimiter({
        knex: mockKnex,
        integrationId: 'test-id',
        integrationName: 'test-name',
        requestsPerSecond: 10,
        burst: 20,
        batchSize: 3,
      });

      await limiter.acquire();

      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(true);
      expect(limiter.tryAcquire()).toBe(false);
    });
  });
});
