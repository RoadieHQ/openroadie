import { useCallback, useMemo } from 'react';
import { useCapabilities } from './use-capabilities';
import {
  buildReferenceUsageIndex,
  lookupReferenceUsage,
  selectReferencedTargets,
  type ReferenceTarget,
  type ReferencedTarget,
  type ReferencingCapability,
} from './reference-usage';
import type { CapabilityReferenceType } from './editor/references';

export interface UseReferenceUsageResult {
  /**
   * True until the capability list has resolved.
   *
   * Callers MUST NOT conclude "nothing references this" while true — render a
   * "checking…" state or disable the confirm control instead. The accessors
   * return empty arrays until the list is in, which would otherwise read as a
   * clean bill of health.
   */
  loading: boolean;
  /** Capabilities referencing `@type:slug`. */
  getUsage(
    type: CapabilityReferenceType,
    slug: string | null | undefined,
  ): ReferencingCapability[];
  /** The subset of `targets` that some capability references. */
  getReferencedTargets(
    targets: readonly ReferenceTarget[],
    excludeCapabilityIds?: ReadonlySet<string>,
  ): ReferencedTarget[];
}

/**
 * Which capabilities reference a resource, for rename and delete warnings.
 *
 * Reads the shared capabilities list query, so it's de-duplicated app-wide —
 * but pass `skip` on surfaces that only need it once a dialog opens.
 */
export function useReferenceUsage(options?: {
  skip?: boolean;
}): UseReferenceUsageResult {
  const { capabilities, loading } = useCapabilities({ skip: options?.skip });

  const index = useMemo(
    () => buildReferenceUsageIndex(capabilities),
    [capabilities],
  );

  const getUsage = useCallback(
    (type: CapabilityReferenceType, slug: string | null | undefined) =>
      lookupReferenceUsage(index, type, slug),
    [index],
  );

  const getReferencedTargets = useCallback(
    (
      targets: readonly ReferenceTarget[],
      excludeCapabilityIds?: ReadonlySet<string>,
    ) => selectReferencedTargets(index, targets, excludeCapabilityIds),
    [index],
  );

  return { loading, getUsage, getReferencedTargets };
}
