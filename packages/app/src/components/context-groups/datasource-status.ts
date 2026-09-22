import {
  EXECUTION,
  LIFECYCLE,
  READINESS,
  type OverviewStatusTone,
} from '../overview';
import type { ContextGroupDatasourceStatus } from '../../api/datastore/datastore-client';

/**
 * A data source's status *within a context group* reuses the app-wide status
 * taxonomy rather than a bespoke Live/Inactive pair: a source that is enabled,
 * configured, and has synced objects reads **Available**; otherwise it decomposes
 * into the same states used everywhere else — **Disabled**, **Never run**, or
 * **Needs setup** — with the backend's specific reason in the tooltip.
 *
 * The backend (`ContextGroupDao.enrichRule`) sets `live` and, when not live, a
 * specific `inactiveReason`. We key off those exact strings for the two states
 * that map to a distinct axis; every other not-live reason is a setup problem.
 */

/** Backend reason (ContextGroupDao) → the datasource is turned off. */
const DISABLED_REASON = 'Data source disabled';
/** Backend reason (ContextGroupDao) → configured but hasn't produced objects. */
const NO_SYNC_REASON = 'No successful sync yet';

/** Tooltip for an Available source — explains what it means in a group. */
const AVAILABLE_TOOLTIP = 'Providing objects to this group.';
/** Fallback tooltip when a source is unavailable but the backend gave no reason. */
const UNAVAILABLE_FALLBACK = 'Not providing objects to this group.';

export interface ContextGroupDatasourceDisplayStatus {
  tone: OverviewStatusTone;
  label: string;
  tooltip: string;
}

export function getContextGroupDatasourceStatus(
  status: ContextGroupDatasourceStatus,
): ContextGroupDatasourceDisplayStatus {
  if (status.live) {
    return {
      tone: READINESS.ready.tone,
      label: 'Available',
      tooltip: AVAILABLE_TOOLTIP,
    };
  }

  const reason = status.inactiveReason;

  if (reason === DISABLED_REASON) {
    return { ...LIFECYCLE.disabled, tooltip: reason };
  }

  if (reason === NO_SYNC_REASON) {
    return { ...EXECUTION.never, tooltip: reason };
  }

  return {
    ...READINESS.needsSetup,
    tooltip: reason ?? UNAVAILABLE_FALLBACK,
  };
}
