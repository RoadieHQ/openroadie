export type StatusFilter = 'all' | 'active' | 'inactive';

export interface StatusOption {
  value: StatusFilter;
  label: string;
}

/** Canonical enabled/disabled filter choices shared by overview page toolbars. */
export const STATUS_OPTIONS: StatusOption[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

/** Shared sizing for controls in overview page toolbars (e.g. beside search). */
export const toolbarControlButtonClassName =
  'h-8 shrink-0 gap-1.5 px-3 text-sm font-medium [&_svg]:size-3.5';

/** Primary “create” control in overview headers; reuse for aligned page toolbars (e.g. admin). */
export const toolbarPrimaryCtaButtonClassName = toolbarControlButtonClassName;
