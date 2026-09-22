import { vi } from 'vitest';

import { ConfigReader } from '@roadiehq/config';
import { RedisStreamEventsService } from './RedisStreamEventsService';
import { mockServices } from '@roadiehq/backend-test-utils';
import Redis from 'ioredis-mock';
import { LoggerService } from '@roadiehq/extensions-api';

const config = new ConfigReader({
  podId: 'pod-example',
  redis: {
    host: 'example.com',
    port: 1234,
  },
});

describe('SNSEventsService', () => {
  let logger: LoggerService;

  beforeEach(() => {
    logger = mockServices.logger.mock();
  });

  it('should publish an event to the redis stream', async () => {
    const redisMock = new Redis();
    const eventsService = new RedisStreamEventsService({ config, logger });
    // @ts-ignore
    eventsService.redis = redisMock;

    redisMock.xadd = vi.fn();
    const event = {
      topic: 'TestTopic',
      eventPayload: { key: 'value' },
    };

    await eventsService.publish(event);

    expect(redisMock.xadd).toHaveBeenCalledWith(
      'roadie-backend-topic',
      '*',
      'topic',
      'TestTopic',
      'payload',
      JSON.stringify(event),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Published event to Redis stream: TestTopic',
    );
  });

  it('should throw an error properly', async () => {
    const redisMock = new Redis();
    const eventsService = new RedisStreamEventsService({ config, logger });
    // @ts-ignore
    eventsService.redis = redisMock;

    redisMock.xadd = vi.fn(() => {
      throw new Error('error');
    });
    const event = {
      topic: 'TestTopic',
      eventPayload: { key: 'value' },
    };

    await expect(eventsService.publish(event)).rejects.toThrow('error');
    expect(logger.error).toHaveBeenCalledWith('Failed to publish event: error');
  });

  it('subscribers get sent correctly', async () => {
    const redisMock = new Redis();
    const eventsService = new RedisStreamEventsService({ config, logger });
    // @ts-ignore
    eventsService.redis = redisMock;

    const event = {
      topic: 'TestTopic',
      eventPayload: { key: 'value' },
    };

    redisMock.xadd(
      'roadie-backend-topic',
      '*',
      'topic',
      'TestTopic',
      'payload',
      JSON.stringify(event),
    );

    const eventHandler = vi.fn();
    await eventsService.subscribe({
      topics: ['TestTopic'],
      onEvent: eventHandler,
      id: 'test',
    });

    await eventsService.start();
    await eventsService.stop();

    expect(eventHandler).toHaveBeenCalledWith(event);
    expect(logger.info).toHaveBeenCalledWith(
      `Delivered event TestTopic to subscriber test`,
    );
  });
});
