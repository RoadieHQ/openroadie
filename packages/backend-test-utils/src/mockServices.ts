/*
 * Copyright 2025 Larder Software Ltd.
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

import {
  coreServices,
  createServiceFactory,
  LoggerService,
  RootLoggerService,
  DiscoveryService,
  HttpAuthService,
  HttpRouterService,
  RoadieCredentials,
  RoadieUserPrincipal,
} from '@roadiehq/extensions-api';
import { ConfigReader } from '@roadiehq/config';
import { vi } from 'vitest';
import type { ServiceMock } from './types';
import type { Router } from 'express';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createMockFn<T extends (...args: any[]) => any>(impl?: T): T {
  return vi.fn(impl) as T;
}

/**
 * Structural mirror of `EventsService` from `@roadiehq/backend-defaults`.
 *
 * Declared here rather than imported: backend-defaults devDepends on this
 * package, so importing it back would close a cycle. TypeScript is structural,
 * so a value of this type is assignable wherever an `EventsService` is wanted.
 */
type MockedEventsService = {
  publish(params: {
    topic: string;
    eventPayload: unknown;
    metadata?: Record<string, string | string[] | undefined>;
  }): Promise<void>;
  subscribe(options: {
    id: string;
    topics: string[];
    onEvent: (params: {
      topic: string;
      eventPayload: unknown;
    }) => Promise<void>;
  }): Promise<void>;
};

/**
 * Creates a mock logger service for testing.
 */
function createMockLoggerService(
  partialImpl?: Partial<LoggerService>,
): LoggerService {
  return {
    info: createMockFn(),
    warn: createMockFn(),
    error: createMockFn(),
    debug: createMockFn(),
    child: createMockFn(() => createMockLoggerService(partialImpl)),
    ...partialImpl,
  };
}

/**
 * Creates a mock discovery service for testing.
 */
function createMockDiscoveryService(
  partialImpl?: Partial<DiscoveryService>,
): DiscoveryService {
  return {
    getBaseUrl: createMockFn(
      async (pluginId: string) => `http://localhost:7007/api/${pluginId}`,
    ),
    getExternalBaseUrl: createMockFn(
      async (pluginId: string) => `http://localhost:7007/api/${pluginId}`,
    ),
    ...partialImpl,
  };
}

/**
 * Creates a mock HTTP auth service for testing.
 */
function createMockHttpAuthService(
  partialImpl?: Partial<HttpAuthService>,
): HttpAuthService {
  const defaultCredentials: RoadieCredentials<RoadieUserPrincipal> = {
    $$type: '@roadiehq/RoadieCredentials',
    expiresAt: undefined,
    principal: {
      type: 'user',
      userId: 'mock-user',
    },
  };

  return {
    credentials: createMockFn(
      async () => defaultCredentials,
    ) as HttpAuthService['credentials'],
    issueUserCookie: createMockFn(async () => ({ expiresAt: new Date() })),
    ...partialImpl,
  };
}

/**
 * Creates a mock HTTP router service for testing.
 */
function createMockHttpRouterService(
  partialImpl?: Partial<HttpRouterService>,
): HttpRouterService {
  return {
    use: createMockFn((_router: Router) => {}),
    addAuthPolicy: createMockFn(),
    ...partialImpl,
  };
}

/**
 * Creates a mock events service for testing.
 */
function createMockEventsService(
  partialImpl?: Partial<MockedEventsService>,
): MockedEventsService {
  return {
    publish: createMockFn(async () => {}),
    subscribe: createMockFn(async () => {}),
    ...partialImpl,
  };
}

/**
 * Mock service implementations for testing backend plugins.
 *
 * @public
 */
export const mockServices = {
  /**
   * Mock logger service.
   */
  logger: {
    mock: (partialImpl?: Partial<LoggerService>) =>
      createMockLoggerService(partialImpl),
    factory: () =>
      createServiceFactory({
        service: coreServices.logger,
        deps: {},
        factory: async () => createMockLoggerService(),
      }),
  } as ServiceMock<LoggerService>,

  /**
   * Mock root logger service.
   */
  rootLogger: {
    mock: (partialImpl?: Partial<RootLoggerService>) =>
      createMockLoggerService(partialImpl) as RootLoggerService,
    factory: () =>
      createServiceFactory({
        service: coreServices.rootLogger,
        deps: {},
        factory: async () => createMockLoggerService() as RootLoggerService,
      }),
  } as ServiceMock<RootLoggerService>,

  /**
   * Mock root config service.
   */
  rootConfig: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mock: (partialImpl?: Partial<{ data: Record<string, any> }>) =>
      new ConfigReader(partialImpl?.data ?? {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    factory: (options?: { data?: Record<string, any> }) =>
      createServiceFactory({
        service: coreServices.rootConfig,
        deps: {},
        factory: async () => new ConfigReader(options?.data ?? {}),
      }),
  },

  /**
   * Mock discovery service.
   */
  discovery: {
    mock: (partialImpl?: Partial<DiscoveryService>) =>
      createMockDiscoveryService(partialImpl),
    factory: () =>
      createServiceFactory({
        service: coreServices.discovery,
        deps: {},
        factory: async () => createMockDiscoveryService(),
      }),
  } as ServiceMock<DiscoveryService>,

  /**
   * Mock HTTP auth service.
   */
  httpAuth: {
    mock: (partialImpl?: Partial<HttpAuthService>) =>
      createMockHttpAuthService(partialImpl),
    factory: () =>
      createServiceFactory({
        service: coreServices.httpAuth,
        deps: {},
        factory: async () => createMockHttpAuthService(),
      }),
  } as ServiceMock<HttpAuthService>,

  /**
   * Mock HTTP router service.
   */
  httpRouter: {
    mock: (partialImpl?: Partial<HttpRouterService>) =>
      createMockHttpRouterService(partialImpl),
    factory: () =>
      createServiceFactory({
        service: coreServices.httpRouter,
        deps: {},
        factory: async () => createMockHttpRouterService(),
      }),
  } as ServiceMock<HttpRouterService>,

  /**
   * Mock events service.
   */
  events: {
    mock: (partialImpl?: Partial<MockedEventsService>) =>
      createMockEventsService(partialImpl),
    factory: () => {
      throw new Error('events.factory() not implemented');
    },
  },
};
