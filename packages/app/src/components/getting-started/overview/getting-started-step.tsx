import { Link } from 'react-router';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { cn } from '@roadiehq/ui/utils';
import type { OnboardingStep } from '../use-onboarding-progress';

export function GettingStartedStep({
  step,
  index,
  primary = false,
}: {
  step: OnboardingStep;
  index: number;
  /** The next incomplete step — emphasized as the obvious thing to do next. */
  primary?: boolean;
}) {
  const { icon: Icon, done } = step;
  return (
    <li
      className={cn(
        'flex items-start gap-4 border-b border-border/60 py-4 last:border-b-0',
        primary && 'rounded-lg border-b-0 bg-accent/40 px-3',
      )}
    >
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center rounded-md',
          done
            ? 'bg-success/10 text-success'
            : primary
              ? 'bg-foreground text-background'
              : 'bg-muted text-muted-foreground',
        )}
        aria-hidden
      >
        {done ? <Check className="size-4" /> : <Icon className="size-4" />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-muted-foreground">
            Step {index + 1}
          </span>
          {done ? (
            <span className="text-[12px] font-medium text-success">Done</span>
          ) : primary ? (
            <span className="text-[12px] font-medium text-foreground">
              Next up
            </span>
          ) : null}
        </div>
        <p
          className={cn(
            'mt-0.5 text-sm font-medium',
            done ? 'text-muted-foreground line-through' : 'text-foreground',
          )}
        >
          {step.title}
        </p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {step.description}
        </p>
      </div>

      {done ? null : (
        <Button
          asChild
          variant={primary ? 'default' : 'outline'}
          size="sm"
          className="shrink-0"
        >
          <Link to={step.cta.to}>
            {step.cta.label}
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      )}
    </li>
  );
}
