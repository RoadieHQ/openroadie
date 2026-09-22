import { Knex } from 'knex';
import { LoggerService } from '@roadiehq/extensions-api';

const TABLE_NAME = 'github_state_nonces';

export class GithubStateNonceDao {
  private readonly knex: Knex;
  private readonly logger: LoggerService;

  constructor(options: { knex: Knex; logger: LoggerService }) {
    this.knex = options.knex;
    this.logger = options.logger.child({ name: 'GithubStateNonceDao' });
  }

  private table() {
    return this.knex(TABLE_NAME);
  }

  async create(jti: string, expiresAt: Date): Promise<void> {
    await this.table().insert({
      jti,
      expires_at: expiresAt.toISOString(),
    });
  }

  async consume(jti: string): Promise<boolean> {
    const result = await this.knex.raw(
      `UPDATE ${TABLE_NAME} SET used_at = now() WHERE jti = ? AND used_at IS NULL AND expires_at > now()`,
      [jti],
    );

    const rowCount =
      typeof result === 'object' && result !== null
        ? (result.rowCount ?? 0)
        : 0;

    if (rowCount === 0) {
      this.logger.info(`Nonce rejected (already used or expired): ${jti}`);
      return false;
    }

    return true;
  }

  async pruneExpired(): Promise<number> {
    const count = await this.table()
      .where('expires_at', '<', this.knex.fn.now())
      .delete();
    return count;
  }
}
