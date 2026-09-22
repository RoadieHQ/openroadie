import { CheckCircle2 } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@roadiehq/ui/card';
import { Skeleton } from '@roadiehq/ui/skeleton';
import type { OnboardingProgress } from '../use-onboarding-progress';
import { GettingStartedStep } from './getting-started-step';

export function GettingStartedChecklist({
  progress,
  onDismiss,
}: {
  progress: OnboardingProgress;
  /** Marks onboarding dismissed and leaves the surface. */
  onDismiss: () => void;
}) {
  const { steps, completedCount, totalCount, complete, loading } = progress;
  const pct = totalCount === 0 ? 0 : (completedCount / totalCount) * 100;
  // Spotlight the first not-yet-done step as the obvious next action, so each
  // completed step nudges the user straight to the next one.
  const nextStepIndex = steps.findIndex(step => !step.done);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle>Set up your workspace</CardTitle>
            <CardDescription className="mt-1">
              Walk from an empty app to working capabilities. Each step lights
              up on its own as you go — nothing here blocks you.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            onClick={onDismiss}
          >
            {complete ? 'Dismiss' : 'Skip for now'}
          </Button>
        </div>

        {!loading && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-[13px]">
              <span className="font-medium text-foreground">
                {completedCount} of {totalCount} complete
              </span>
              {complete && (
                <span className="flex items-center gap-1.5 font-medium text-success">
                  <CheckCircle2 className="size-4" />
                  All set
                </span>
              )}
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-success"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="flex items-start gap-4">
                <Skeleton className="size-8 shrink-0 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
                <Skeleton className="h-8 w-28 shrink-0" />
              </div>
            ))}
          </div>
        ) : (
          <ul className="flex flex-col">
            {steps.map((step, index) => (
              <GettingStartedStep
                key={step.id}
                step={step}
                index={index}
                primary={index === nextStepIndex}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
