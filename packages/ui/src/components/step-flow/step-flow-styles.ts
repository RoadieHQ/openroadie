export type StepVariant =
  | 'trigger'
  | 'source'
  | 'transform'
  | 'sink'
  | 'output';

type StepColors = {
  primary: string;
  primarySoft: string;
  bg: string;
  fieldBg: string;
  border: string;
  glow: string;
};

const TOKENS = {
  primary: 'var(--color-primary)',
  success: 'var(--color-success)',
  info: 'var(--color-info)',
  warning: 'var(--color-warning)',
  destructive: 'var(--color-destructive)',
  mutedForeground: 'var(--color-muted-foreground)',
} as const;

const alpha = (color: string, percentage: number) =>
  `color-mix(in srgb, ${color} ${percentage}%, transparent)`;

const makeStepColors = (primary: string): StepColors => ({
  primary,
  primarySoft: alpha(primary, 50),
  bg: alpha(primary, 8),
  fieldBg: `color-mix(in srgb, ${primary} 8%, var(--color-card))`,
  border: alpha(primary, 30),
  glow: alpha(primary, 15),
});

// Module-level color objects so React's referential-equality checks on
// inline style values stay stable across renders. Adding a new variant or
// status tone? Define a constant here, not inline in the switch.
const VARIANT_COLOR_INFO = makeStepColors(TOKENS.info);

export function getVariantColors(variant: StepVariant): StepColors {
  switch (variant) {
    case 'trigger':
    case 'source':
    case 'transform':
    case 'sink':
    case 'output':
      return VARIANT_COLOR_INFO;
    default:
      return VARIANT_COLOR_INFO;
  }
}

const STATUS_COLOR_IDLE: StepColors = {
  primary: TOKENS.mutedForeground,
  primarySoft: alpha(TOKENS.mutedForeground, 50),
  bg: alpha(TOKENS.mutedForeground, 8),
  fieldBg: `color-mix(in srgb, ${TOKENS.mutedForeground} 8%, var(--color-card))`,
  border: alpha(TOKENS.mutedForeground, 25),
  glow: alpha(TOKENS.mutedForeground, 12),
};

const STATUS_COLOR_ERROR = makeStepColors(TOKENS.destructive);
const STATUS_COLOR_SUCCESS = makeStepColors(TOKENS.success);

export type StepStatusTone = 'idle' | 'error' | 'success';

export function getStatusColors(status: StepStatusTone): StepColors {
  switch (status) {
    case 'error':
      return STATUS_COLOR_ERROR;
    case 'success':
      return STATUS_COLOR_SUCCESS;
    default:
      return STATUS_COLOR_IDLE;
  }
}
