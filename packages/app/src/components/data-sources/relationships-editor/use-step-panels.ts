import { useState } from 'react';
import type { StageRole } from './relationship-stages';

/**
 * Panel-visibility state for the stepped editor. Every object column can flip in
 * place between its object preview and its configuration (a cogwheel) — or its
 * filter (Source/Target only) via a filter icon. A column shows at most one
 * panel: config and filter are mutually exclusive. The Match column has its own
 * summary/config flag (`matchConfigOpen`), and `expanded` shows/hides the whole
 * preview pipeline below the step map.
 */
export function useStepPanels(isEdit: boolean) {
  const [configRoles, setConfigRoles] = useState<ReadonlySet<StageRole>>(
    () => new Set(),
  );
  const [filterRoles, setFilterRoles] = useState<ReadonlySet<StageRole>>(
    () => new Set(),
  );
  // The Match column (between the last object and the target) flips between its
  // join summary and a config panel for the comparison strategy. Its own flag —
  // the match stage isn't one of the object columns keyed by StageRole.
  const [matchConfigOpen, setMatchConfigOpen] = useState(false);
  // The preview panels expand/collapse from a chevron at the end of the step
  // map: open by default when creating a rule, collapsed when editing/reviewing
  // an existing one (where the map alone is usually enough to orient).
  const [expanded, setExpanded] = useState(!isEdit);

  const withoutRole = (set: ReadonlySet<StageRole>, role: StageRole) => {
    if (!set.has(role)) {
      return set;
    }
    const next = new Set(set);
    next.delete(role);
    return next;
  };
  const toggleConfig = (role: StageRole) => {
    // Configuring from anywhere (a step-map node or a cogwheel) implies you want
    // the panels visible, so opening a panel also expands them.
    setExpanded(true);
    setConfigRoles(prev => {
      const next = new Set(prev);
      if (next.has(role)) {
        next.delete(role);
      } else {
        next.add(role);
      }
      return next;
    });
    setFilterRoles(prev => withoutRole(prev, role));
  };
  const toggleFilter = (role: StageRole) => {
    setExpanded(true);
    setFilterRoles(prev => {
      const next = new Set(prev);
      if (next.has(role)) {
        next.delete(role);
      } else {
        next.add(role);
      }
      return next;
    });
    setConfigRoles(prev => withoutRole(prev, role));
  };
  const openConfig = (role: StageRole) => {
    setExpanded(true);
    setConfigRoles(prev => new Set(prev).add(role));
    setFilterRoles(prev => withoutRole(prev, role));
  };
  const closeConfig = (role: StageRole) =>
    setConfigRoles(prev => withoutRole(prev, role));

  return {
    configRoles,
    filterRoles,
    matchConfigOpen,
    setMatchConfigOpen,
    expanded,
    setExpanded,
    toggleConfig,
    toggleFilter,
    openConfig,
    closeConfig,
  };
}
