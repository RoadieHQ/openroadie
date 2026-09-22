import type { Transition } from 'motion/react';

export const motionDurationsMs = {
  instant: 0,
  micro: 100,
  fast: 150,
  standard: 200,
  panel: 300,
  focus: 450,
  emphasis: 800,
} as const;

export const motionDurations = {
  instant: 0,
  micro: motionDurationsMs.micro / 1000,
  fast: motionDurationsMs.fast / 1000,
  standard: motionDurationsMs.standard / 1000,
  panel: motionDurationsMs.panel / 1000,
  focus: motionDurationsMs.focus / 1000,
  emphasis: motionDurationsMs.emphasis / 1000,
} as const;

export const motionEasings = {
  linear: 'linear',
  out: 'easeOut',
  standard: [0.4, 0, 0.2, 1],
} as const;

export const motionClasses = {
  colors: 'motion-colors',
  opacity: 'motion-opacity',
  opacityMicro: 'motion-opacity-micro',
  opacityFast: 'motion-opacity-fast',
  transform: 'motion-transform',
  transformFast: 'motion-transform-fast',
  transformStandard: 'motion-transform-standard',
  transformStandardReduced: 'motion-transform-standard-reduced',
  transformInteractive: 'motion-transform-interactive',
  all: 'motion-all',
  allFast: 'motion-all-fast',
  allStandard: 'motion-all-standard',
  allPanel: 'motion-all-panel',
  layoutWidth: 'motion-layout-width',
  layoutWidthBare: 'motion-layout-width-bare',
  sidebarShell: 'motion-sidebar-shell',
  sidebarItem: 'motion-sidebar-item',
  panel: 'motion-panel',
  panelWidth: 'motion-panel-width',
  heightStandard: 'motion-height-standard',
  gridRowsStandard: 'motion-grid-rows-standard',
  borderOpacity: 'motion-border-opacity',
  workflowNode: 'motion-workflow-node',
  workflowActions: 'motion-workflow-actions',
  iconSpin: 'motion-icon-spin',
  pulse: 'motion-pulse',
  motionSafePulse: 'motion-safe-pulse',
  skeleton: 'motion-skeleton',
  accordionDown: 'motion-accordion-down',
  accordionUp: 'motion-accordion-up',
  collapsibleDown: 'motion-collapsible-down',
  collapsibleUp: 'motion-collapsible-up',
  stepBorder: 'motion-step-border',
  stepConnector: 'motion-step-connector',
  fadeIn: 'motion-fade-in',
  actionNotice: 'motion-action-notice',
  radixOverlay: 'motion-radix-overlay',
  radixPopover: 'motion-radix-popover',
  radixTooltip: 'motion-radix-tooltip',
  radixDialogContent: 'motion-radix-dialog-content',
  sheetContent: 'motion-sheet-content',
  verticalDisclosure: 'motion-vertical-disclosure',
  nestedButtonColors: 'motion-nested-button-colors',
} as const;

export const motionTransitions = {
  instant: { duration: motionDurations.instant } satisfies Transition,
  hoverTap: {
    duration: motionDurations.micro,
    ease: motionEasings.out,
  } satisfies Transition,
  sidebarDisclosure: {
    duration: motionDurations.standard,
    ease: motionEasings.out,
  } satisfies Transition,
  listContainer: {
    staggerChildren: 0.05,
  } satisfies Transition,
  gentleFloat: {
    duration: motionDurations.emphasis * 4,
    ease: 'easeInOut',
    repeat: Number.POSITIVE_INFINITY,
  } satisfies Transition,
  shimmer: (duration: number): Transition => ({
    duration,
    ease: motionEasings.linear,
    repeat: Number.POSITIVE_INFINITY,
  }),
} as const;

// Inline `style`/`animation` strings for SVG and imperative motion. These are
// consumed from JS, where Tailwind never sees the `var(--motion-*)` reference —
// and Tailwind v4 tree-shakes any `@theme` token not referenced by generated
// CSS, so those custom properties are absent from `:root` at runtime. Every
// var() below therefore carries a literal fallback equal to its token value so
// the declaration stays valid even when the property is not emitted.
export const motionStyleTransitions = {
  graphHandle:
    'opacity var(--motion-duration-micro, 100ms) var(--motion-ease-out, ease-out), transform var(--motion-duration-micro, 100ms) var(--motion-ease-out, ease-out)',
  ruleEdge:
    'stroke-width var(--motion-duration-fast, 150ms), opacity var(--motion-duration-fast, 150ms)',
  graphFade: 'opacity var(--motion-duration-panel, 300ms) ease',
} as const;

export const motionAnimations = {
  ruleEdgeDrawIn:
    'ruleEdgeDrawIn var(--motion-duration-emphasis, 800ms) var(--motion-ease-standard, cubic-bezier(0.4, 0, 0.2, 1)) forwards',
} as const;
