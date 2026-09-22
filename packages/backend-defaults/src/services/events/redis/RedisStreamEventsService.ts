import { Config } from '@roadiehq/config';
import { isError } from '../../../errors';
import { LoggerService } from '@roadiehq/extensions-api';
import Redis from 'ioredis';
import { EventsServiceForPlugin } from '../EventsServiceForPlugin';
import type { EventsService, EventParams } from '../types';

type EventsServiceEventHandler = (params: EventParams) => Promise<void>;

type EventsServiceSubscribeOptions = {
  id: string;
  topics: string[];
  onEvent: EventsServiceEventHandler;
};

const REDIS_STREAM = 'roadie-backend-topic';

export class RedisStreamEventsService implements EventsService {
  private redis: Redis;
  private logger: LoggerService;
  private pollingPromise?: Promise<void>;
  private stopped: boolean = false;
  private subscriptions: Map<string, EventsServiceSubscribeOptions[]> =
    new Map();
  private readonly streamSubscriberId: string;

  constructor({ config, logger }: { config: Config; logger: LoggerService }) {
    const redisConfig = config.getConfig('redis');
    const host = redisConfig.getString('host');
    const port = redisConfig.getNumber('port');
    this.streamSubscriberId = config.getString('podId');

    this.redis = new Redis({ host, port });
    this.logger = logger;
  }

  async start() {
    if (!this.pollingPromise) {
      this.pollingPromise = this.pollMessages(REDIS_STREAM);
    }
  }

  async verify(): Promise<void> {
    await this.redis.ping();
  }

  async stop() {
    this.stopped = true;
    if (this.pollingPromise) {
      await this.pollingPromise;
    }
    await this.redis.quit();
  }

  async publish(params: EventParams): Promise<void> {
    const { topic, eventPayload, metadata } = params;
    const messageBody = JSON.stringify({ topic, eventPayload, metadata });

    try {
      await this.redis.xadd(
        REDIS_STREAM,
        '*',
        'topic',
        topic,
        'payload',
        messageBody,
      );
      this.logger.info(`Published event to Redis stream: ${topic}`);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to publish event: ${
          isError(error) ? error.message : 'unknown error'
        }`,
      );
      throw error;
    }
  }

  forPlugin(pluginId: string): EventsService {
    return new EventsServiceForPlugin(this, pluginId);
  }

  async subscribe(subscription: EventsServiceSubscribeOptions): Promise<void> {
    const { topics } = subscription;
    for (const topic of topics) {
      const existing = this.subscriptions.get(topic);
      if (existing) {
        existing.push(subscription);
      } else {
        this.subscriptions.set(topic, [subscription]);
      }
    }
    this.logger.info(`Subscribed to topics: ${topics.join(', ')}`);
  }

  private async pollMessages(stream: string) {
    let lastId =
      (await this.redis.get(`last_processed_id-${this.streamSubscriberId}`)) ||
      '0';

    while (!this.stopped) {
      try {
        const entries = await this.redis.xread(
          'BLOCK',
          5000,
          'STREAMS',
          stream,
          lastId,
        );
        if (!entries) {
          continue;
        }

        for (const [, messages] of entries) {
          for (const [id, fields] of messages) {
            const messageMap = new Map<string, string>();
            for (let i = 0; i + 1 < fields.length; i += 2) {
              const fieldName = fields.at(i);
              const fieldValue = fields.at(i + 1);
              if (
                typeof fieldName === 'string' &&
                typeof fieldValue === 'string'
              ) {
                messageMap.set(fieldName, fieldValue);
              }
            }

            const topic = messageMap.get('topic') ?? '';
            const params = JSON.parse(messageMap.get('payload') || '{}');

            const topicSubscriptions = this.subscriptions.get(topic);
            if (topicSubscriptions) {
              for (const subscription of topicSubscriptions) {
                try {
                  this.logger.info(
                    `Delivering event ${topic} to subscriber ${subscription.id}`,
                  );
                  await subscription.onEvent(params);
                  this.logger.info(
                    `Delivered event ${topic} to subscriber ${subscription.id}`,
                  );
                } catch (error: unknown) {
                  this.logger.error(
                    `Error delivering event ${topic} to ${subscription.id}: ${
                      isError(error) ? error.message : 'unknown error'
                    }`,
                  );
                }
              }
            }

            await this.redis.set(
              `last_processed_id-${this.streamSubscriberId}`,
              id,
            );
            lastId = id;
          }
        }
      } catch (error: unknown) {
        this.logger.error(
          `Error polling Redis stream: ${
            isError(error) ? error.message : 'unknown error'
          }`,
        );
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
}
