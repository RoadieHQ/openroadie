import type { LoggerService } from '@roadiehq/extensions-api';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';
import { AutoApplyCoalescer } from '../../database/AutoApplyCoalescer';

export class ContextGroupSyncScheduler {
  private readonly coalescer: AutoApplyCoalescer;
  private readonly materializeForDatasource: (
    datasourceId: string,
    workspaceId: string,
  ) => Promise<void>;
  private readonly workspaceExists: (workspaceId: string) => Promise<boolean>;

  constructor(options: {
    delayMs?: number;
    logger: LoggerService;
    materializeForDatasource: (
      datasourceId: string,
      workspaceId: string,
    ) => Promise<void>;
    workspaceExists?: (workspaceId: string) => Promise<boolean>;
  }) {
    this.materializeForDatasource = options.materializeForDatasource;
    this.workspaceExists =
      options.workspaceExists ??
      (async workspaceId => workspaceId === DEFAULT_WORKSPACE_ID);
    this.coalescer = new AutoApplyCoalescer({
      delayMs: options.delayMs,
      logger: options.logger,
      run: async (datasourceIds, workspaceId) => {
        if (!(await this.workspaceExists(workspaceId))) {
          return;
        }
        for (const datasourceId of datasourceIds) {
          try {
            await options.materializeForDatasource(datasourceId, workspaceId);
          } catch (error) {
            options.logger.warn(
              `Failed to sync context groups for datasource ${datasourceId}: ${error}`,
            );
          }
        }
      },
    });
  }

  schedule(datasourceId: string, workspaceId = DEFAULT_WORKSPACE_ID): void {
    this.coalescer.schedule(datasourceId, workspaceId);
  }

  /**
   * Rebuild the datasource's context groups immediately and resolve when the
   * rebuild is done, so a caller can refetch groups right after. The pending
   * debounced entry for this datasource is absorbed rather than left queued —
   * every rebuild regenerates group ids, so a trailing debounced run would
   * invalidate whatever the caller fetched moments after this resolves.
   * Unlike the debounced runs, failures propagate to the caller (with the
   * debounced rebuild restored so the groups still converge eventually).
   */
  async syncDatasourceNow(
    datasourceId: string,
    workspaceId = DEFAULT_WORKSPACE_ID,
  ): Promise<void> {
    this.coalescer.unschedule(datasourceId, workspaceId);
    // Run other queued work first, then take a slot on the coalescer's serial
    // chain. Two overlapping rebuilds of the same rule both commit their
    // group sets (each transaction's DELETE misses the other's uncommitted
    // inserts), so no two rebuilds may run concurrently — a debounced batch,
    // another synchronous rebuild, or any mix.
    await this.coalescer.flushNow();
    try {
      await this.coalescer.runExclusive(async () => {
        if (await this.workspaceExists(workspaceId)) {
          await this.materializeForDatasource(datasourceId, workspaceId);
        }
      });
    } catch (error) {
      this.coalescer.schedule(datasourceId, workspaceId);
      throw error;
    }
  }

  async flushNow(): Promise<void> {
    await this.coalescer.flushNow();
  }
}
