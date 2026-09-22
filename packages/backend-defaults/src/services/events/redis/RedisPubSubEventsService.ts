import Redis from 'ioredis';
import { Config } from '@roadiehq/config';
import { isError } from '../../../errors';
import { LoggerService } from '@roadiehq/extensions-api';
import { EventsServiceForPlugin } from '../EventsServiceForPlugin';
import type { EventsService, EventParams } from '../types';

type EventsServiceEventHandler = (params: EventParams) => Promise<void>;

type EventsServiceSubscribeOptions = {
  id: string;
  topics: string[];
  onEvent: EventsServiceEventHandler;
};

const REDIS_CHANNEL = Object.freeze('roadie-events');

export class RedisPubSubEventsService implements EventsService {
  private redisSubscriber: Redis;
  private redisPublisher: Redis;
  private subscriptions: Map<string, EventsServiceSubscribeOptions[]>;
  private logger: LoggerService;

  constructor({ config, logger }: { config: Config; logger: LoggerService }) {
    const redisConfig = config.getConfig('redis');
    const redisHost = redisConfig.getString('host');
    const redisPort = redisConfig.getNumber('port');

    this.redisSubscriber = new Redis({ host: redisHost, port: redisPort });
    this.redisPublisher = new Redis({ host: redisHost, port: redisPort });
    this.subscriptions = new Map();
    this.logger = logger;
  }

  async verify(): Promise<void> {
    await this.redisSubscriber.ping();
    await this.redisPublisher.ping();
  }

  forPlugin(pluginId: string): EventsService {
    return new EventsServiceForPlugin(this, pluginId);
  }

  async start() {
    await this.redisSubscriber.subscribe(REDIS_CHANNEL);
    this.logger.info(`Starting listener for Redis channel: ${REDIS_CHANNEL}`);
    this.redisSubscriber.on('message', async (channel, message) => {
      try {
        this.logger.info(`Received message on channel: ${channel}`);
        if (channel !== REDIS_CHANNEL) {
          return;
        }
        const eventParams: EventParams = JSON.parse(message);

        const topicSubscriptions =
          this.subscriptions.get(eventParams.topic) ?? [];
        for (const subscription of topicSubscriptions) {
          this.logger.info(
            `Delivering event ${eventParams.topic} to subscriber ${subscription.id}`,
          );
          await subscription.onEvent(eventParams);
        }
      } catch (error: unknown) {
        this.logger.error(
          `Error handling message on topic ${channel}: ${
            isError(error) ? error.message : 'unknown error'
          }`,
        );
      }
    });
  }

  async publish(params: EventParams): Promise<void> {
    const { topic } = params;

    try {
      const message = JSON.stringify(params);
      await this.redisPublisher.publish(REDIS_CHANNEL, message);
      this.logger.info(`Published event to topic: ${topic}`);
    } catch (error: unknown) {
      this.logger.error(
        `Failed to publish event to topic ${topic}: ${
          isError(error) ? error.message : 'unknown error'
        }`,
      );
      throw error;
    }
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
  }
}
