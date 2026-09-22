import type { LoggerService } from '@roadiehq/extensions-api';
import { DEFAULT_WORKSPACE_ID } from '@roadiehq/workspaces-backend';

const DEFAULT_DELAY_MS = 1500;
/**
 * Buffers rule-application requests during a short window so concurrent
 * datasource refreshes (the workflow scheduler fires multiple datasource
 * refreshes within seconds of each other) trigger one coalesced run instead
 * of N independent fire-and-forget runs whose effects on per-rule attribution
 * flap as they overlap.
 */
export class AutoApplyCoalescer {
  private readonly delayMs: number;
  private readonly logger: LoggerService;
  private readonly run: (
    datasourceIds: string[],
    workspaceId: string,
  ) => Promise<void>;
  private pending = new Map<string, Set<string>>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(options: {
    delayMs?: number;
    logger: LoggerService;
    run: (datasourceIds: string[], workspaceId: string) => Promise<void>;
  }) {
    this.delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
    this.logger = options.logger;
    this.run = options.run;
  }

  schedule(datasourceId: string, workspaceId = DEFAULT_WORKSPACE_ID): void {
    const ids = this.pending.get(workspaceId) ?? new Set<string>();
    ids.add(datasourceId);
    this.pending.set(workspaceId, ids);
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.delayMs);
    if (typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref();
    }
  }

  /** Drop a pending id whose work is being run elsewhere (a synchronous
   *  materialize) — leaving it queued would redo the same rebuild moments
   *  later. Any armed timer stays; an empty flush is a no-op. */
  unschedule(datasourceId: string, workspaceId = DEFAULT_WORKSPACE_ID): void {
    const ids = this.pending.get(workspaceId);
    ids?.delete(datasourceId);
    if (ids?.size === 0) {
      this.pending.delete(workspaceId);
    }
  }

  /** For tests and shutdown — runs the buffered batch immediately. */
  async flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flush();
    if (this.inFlight) await this.inFlight;
  }

  /**
   * Runs work on the same serial chain as the coalesced batches, so it never
   * overlaps a batch or another exclusive run. Rejections propagate to the
   * caller; the chain itself absorbs them so later work still runs.
   */
  runExclusive<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.inFlight ?? Promise.resolve();
    const result = previous.then(work);
    const next: Promise<void> = result
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        if (this.inFlight === next) {
          this.inFlight = null;
        }
      });
    this.inFlight = next;
    return result;
  }

  private flush(): void {
    this.timer = null;
    if (this.pending.size === 0) return;
    const groups = [...this.pending].map(([workspaceId, ids]) => ({
      workspaceId,
      ids: [...ids],
    }));
    this.pending.clear();

    const previous = this.inFlight ?? Promise.resolve();
    const next: Promise<void> = previous
      .then(async () => {
        for (const group of groups) {
          try {
            await this.run(group.ids, group.workspaceId);
          } catch (err) {
            this.logger.error(
              `AutoApplyCoalescer run failed for workspace ${group.workspaceId}: ${err}`,
            );
          }
        }
      })
      .finally(() => {
        if (this.inFlight === next) {
          this.inFlight = null;
        }
      });
    this.inFlight = next;
  }
}
