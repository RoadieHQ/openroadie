import type { IntegrationSecretSummary } from './use-integration-secret-status';

interface IntegrationReadinessItem {
  readyForCurrentScope?: boolean;
}

export function isSecretsReadyForList(
  item: IntegrationReadinessItem,
  summary: IntegrationSecretSummary | undefined,
  secretsLoading: boolean,
): boolean {
  if (summary) {
    if (summary.checkingReadiness) {
      return false;
    }
    if (secretsLoading && summary.requiredSecretRefs.length > 0) {
      return false;
    }
    return summary.configured && item.readyForCurrentScope !== false;
  }
  if (item.readyForCurrentScope === false) {
    return false;
  }
  return !secretsLoading;
}
