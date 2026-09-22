import { Knex } from 'knex';
import { LoggerService } from '@roadiehq/extensions-api';

const TABLE_NAME = 'webhook_deliveries';

export class WebhookDeliveryDao {
  private readonly knex: Knex;
  private readonly logger: LoggerService;

  constructor(options: { knex: Knex; logger: LoggerService }) {
    this.knex = options.knex;
    this.logger = options.logger.child({ name: 'WebhookDeliveryDao' });
  }

  private table() {
    return this.knex(TABLE_NAME);
  }

  async markSeen(type: string, deliveryId: string): Promise<boolean> {
    const result = await this.knex.raw(
      `INSERT INTO ${TABLE_NAME} (type, delivery_id) VALUES (?, ?) ON CONFLICT (type, delivery_id) DO NOTHING`,
      [type, deliveryId],
    );

    const rowCount =
      typeof result === 'object' && result !== null
        ? (result.rowCount ?? result?.rows?.length ?? 0)
        : 0;

    if (rowCount === 0) {
      this.logger.info(
        `Duplicate webhook delivery detected for ${type}: ${deliveryId}`,
      );
      return false;
    }

    return true;
  }

  async pruneOlderThan(days: number): Promise<number> {
    const count = await this.table()
      .where(
        'received_at',
        '<',
        this.knex.raw(`now() - make_interval(days => ?)`, [days]),
      )
      .delete();
    return count;
  }
}
