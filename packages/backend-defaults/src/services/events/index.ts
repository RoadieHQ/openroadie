import { createServiceFactory, coreServices } from '@roadiehq/extensions-api';
import { DefaultEventsService } from './DefaultEventsService';
import { eventsServiceRef } from './eventsServiceRef';
import type { EventsService } from './types';
import { RedisPubSubEventsService } from './redis';
import { SNSEventsService } from './sns';
import { RedisStreamEventsService } from './redis/RedisStreamEventsService';

export { eventsServiceRef } from './eventsServiceRef';
export { entityChangeTopics } from './entityChangeEvents';
export type {
  EventsService,
  EventParams,
  EventsServiceSubscribeOptions,
} from './types';
export type {
  EntityChangeEventPayload,
  EntityChangeOperation,
} from './entityChangeEvents';

export const eventsServiceFactory = createServiceFactory({
  service: eventsServiceRef,
  deps: {
    pluginMetadata: coreServices.pluginMetadata,
    logger: coreServices.logger,
    rootLogger: coreServices.rootLogger,
    config: coreServices.rootConfig,
    rootLifecycle: coreServices.rootLifecycle,
  },
  async createRootContext({ rootLogger, config, rootLifecycle }) {
    const provider = config.getOptionalString('events.provider') || 'memory';
    let events: EventsService & {
      forPlugin: (pluginId: string) => EventsService;
    };

    switch (provider) {
      case 'redis-pubsub':
        events = new RedisPubSubEventsService({
          logger: rootLogger,
          config,
        });
        await (events as RedisPubSubEventsService).verify();

        rootLifecycle.addStartupHook(() => {
          (events as RedisPubSubEventsService).start();
        });
        break;
      case 'redis-stream':
        events = new RedisStreamEventsService({
          logger: rootLogger,
          config,
        });
        await (events as RedisStreamEventsService).verify();
        rootLifecycle.addStartupHook(() => {
          (events as RedisStreamEventsService).start();
        });
        break;
      case 'sns':
        events = new SNSEventsService({ logger: rootLogger, config });
        await (events as SNSEventsService).verify();
        rootLifecycle.addStartupHook(async () => {
          await (events as SNSEventsService).start();
        });

        rootLifecycle.addShutdownHook(async () => {
          await (events as SNSEventsService).stop();
        });
        break;
      default:
        events = DefaultEventsService.create({ logger: rootLogger });
        break;
    }
    return events;
  },
  async factory({ pluginMetadata }, eventsService) {
    return eventsService.forPlugin(pluginMetadata.getId());
  },
});
