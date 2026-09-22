import type { EntityRef, WorkflowRef } from './types';

const VISIBLE_DATA_SOURCE_COUNT = 3;

function usedByNames(names: string[]): string {
  const visibleNames = names.slice(0, VISIBLE_DATA_SOURCE_COUNT).join(', ');
  const remainingCount = names.length - VISIBLE_DATA_SOURCE_COUNT;

  return remainingCount > 0
    ? `Used by: ${visibleNames}, and ${remainingCount} more`
    : `Used by: ${visibleNames}`;
}

export function getIntegrationDeleteDisabledReason(
  referencingDataSources: WorkflowRef[],
): string | null {
  if (referencingDataSources.length === 0) {
    return null;
  }
  return usedByNames(referencingDataSources.map(dataSource => dataSource.name));
}

/**
 * Everything blocking an integration's deletion, across all three reference
 * sites. The data-source-only variant above missed actions and relationship
 * rules entirely, so an integration used solely by an action step deleted
 * cleanly and broke at execution time.
 */
export function getIntegrationUsageReason(item: {
  referencingWorkflows: WorkflowRef[];
  referencingActions: EntityRef[];
  referencingRelationshipRules: EntityRef[];
}): string | null {
  const names = [
    ...item.referencingWorkflows,
    ...item.referencingActions,
    ...item.referencingRelationshipRules,
  ].map(ref => ref.name);

  return names.length === 0 ? null : usedByNames(names);
}
