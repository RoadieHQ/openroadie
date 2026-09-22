/*
 * Copyright 2024 Larder Software Ltd.
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

import type { LoggerService } from '@roadiehq/extensions-api';
import type {
  EventParams,
  EventsService,
  EventsServiceSubscribeOptions,
} from './types';
import { EventsServiceForPlugin } from './EventsServiceForPlugin';

interface Subscription {
  id: string;
  topics: Set<string>;
  onEvent: (params: EventParams) => Promise<void>;
}

/**
 * Events service with plugin scoping support.
 */
export interface EventsServiceWithPluginSupport extends EventsService {
  forPlugin(pluginId: string): EventsService;
}

/**
 * Default in-memory implementation of the events service.
 */
export class DefaultEventsService implements EventsServiceWithPluginSupport {
  private readonly subscriptions: Subscription[] = [];
  private readonly logger: LoggerService;

  static create(options: { logger: LoggerService }): DefaultEventsService {
    return new DefaultEventsService(options.logger);
  }

  private constructor(logger: LoggerService) {
    this.logger = logger.child({ service: 'events' });
  }

  async publish(params: EventParams): Promise<void> {
    const { topic } = params;
    this.logger.debug(`Publishing event to topic: ${topic}`);

    const matchingSubscriptions = this.subscriptions.filter(sub =>
      sub.topics.has(topic),
    );

    await Promise.all(
      matchingSubscriptions.map(async sub => {
        try {
          await sub.onEvent(params);
        } catch (error) {
          this.logger.error(
            `Error in event handler ${sub.id} for topic ${topic}`,
            error as Error,
          );
        }
      }),
    );
  }

  async subscribe(options: EventsServiceSubscribeOptions): Promise<void> {
    const { id, topics, onEvent } = options;
    this.logger.debug(`Subscribing ${id} to topics: ${topics.join(', ')}`);

    this.subscriptions.push({
      id,
      topics: new Set(topics),
      onEvent,
    });
  }

  forPlugin(pluginId: string): EventsService {
    return new EventsServiceForPlugin(this, pluginId);
  }
}
