import { SNS, PublishCommandInput } from '@aws-sdk/client-sns';
import { SQS, ReceiveMessageCommandInput } from '@aws-sdk/client-sqs';
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

export class SNSEventsService implements EventsService {
  private snsClient: SNS;
  private sqsClient: SQS;
  private subscriptions: Map<string, EventsServiceSubscribeOptions[]>;
  private logger: LoggerService;
  private sqsQueueUrl: string;
  private sqsTopicArn: string;
  private pollingPromise?: Promise<void>;
  private stopped: boolean;

  constructor({ config, logger }: { config: Config; logger: LoggerService }) {
    this.sqsQueueUrl = config.getString('sns.queueUrl');
    this.sqsTopicArn = config.getString('sns.topicArn');

    this.snsClient = new SNS({ region: 'eu-west-1' });
    this.sqsClient = new SQS({ region: 'eu-west-1' });
    this.subscriptions = new Map();
    this.logger = logger;
    this.stopped = false;
  }

  async start() {
    this.pollingPromise = this.pollMessages(this.sqsQueueUrl);
  }

  forPlugin(pluginId: string): EventsService {
    return new EventsServiceForPlugin(this, pluginId);
  }

  async verify() {
    // the follow line is here to verify that the queue exists.
    const quereAttrs = await this.sqsClient.getQueueAttributes({
      QueueUrl: this.sqsQueueUrl,
      AttributeNames: ['QueueArn'],
    });
    this.logger.info(`Verified ${quereAttrs.Attributes?.QueueArn}`);
    const topicAttrs = await this.snsClient.getTopicAttributes({
      TopicArn: this.sqsTopicArn,
    });
    this.logger.info(`Verified ${topicAttrs.Attributes?.QueueArn}`);
  }

  async stop() {
    this.stopped = true;
    await this.pollingPromise;
  }

  async publish(params: EventParams): Promise<void> {
    const { topic } = params;
    try {
      const command: PublishCommandInput = {
        TopicArn: this.sqsTopicArn,
        Message: JSON.stringify(params),
        Subject: topic,
      };

      const result = await this.snsClient.publish(command);
      this.logger.debug(
        `Published event to SNS topic: ${topic} ${result.MessageId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to publish event to SNS topic ${topic}: ${error}`,
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

  private async pollMessages(queueUrl: string) {
    while (!this.stopped) {
      try {
        const command: ReceiveMessageCommandInput = {
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 10,
          WaitTimeSeconds: 5,
        };

        const response = await this.sqsClient.receiveMessage(command);
        if (response.Messages) {
          for (const message of response.Messages) {
            try {
              const eventParams: EventParams = JSON.parse(message.Body || '{}');
              const { topic } = eventParams;

              for (const subscription of this.subscriptions.get(topic) ?? []) {
                this.logger.debug(
                  `Delivering event ${topic} to subscriber ${subscription.id}`,
                  {
                    messageId: message.MessageId,
                  },
                );
                try {
                  await subscription.onEvent(eventParams);
                } catch (error: unknown) {
                  this.logger.warn(
                    `Failed to deliver ${topic} message to subscriber ${subscription.id}`,
                    {
                      messageId: message.MessageId,
                      stack: isError(error) ? error.stack : undefined,
                      message: isError(error) ? error.message : undefined,
                    },
                  );
                }
              }

              await this.sqsClient.deleteMessage({
                QueueUrl: queueUrl,
                ReceiptHandle: message.ReceiptHandle!,
              });
            } catch (err: unknown) {
              this.logger.error(
                `Error processing message on queue ${queueUrl} ${
                  message.MessageId
                }: ${isError(err) ? err.message : 'unknown error'}`,
              );
            }
          }
        }
      } catch (err: unknown) {
        this.logger.error(
          `Error polling SQS messages for topic ${queueUrl}: ${
            isError(err) ? err.message : 'unknown error'
          }`,
        );
      }
    }
  }
}
