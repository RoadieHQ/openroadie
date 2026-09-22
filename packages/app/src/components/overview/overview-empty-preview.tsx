import type { ComponentType, ReactNode } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { OverviewListingTableCard } from '../common';

/** A single explanatory bullet: an icon (typically the matching sidebar glyph) and its text. */
export interface OverviewEmptyPreviewBullet {
  icon: ComponentType<{ className?: string }>;
  /** Bold lead-in shown before the text (e.g. the concept name). */
  term: string;
  text: ReactNode;
}

export interface OverviewEmptyPreviewProps {
  title: string;
  description?: ReactNode;
  /** Optional icon bullets rendered below the description to explain related concepts. */
  bullets?: readonly OverviewEmptyPreviewBullet[];
  preview: ReactNode;
  action?: ReactNode;
  /** When the preview finishes assembling; the action fades in then. */
  actionDelay?: number;
}

export function OverviewEmptyPreview({
  title,
  description,
  bullets,
  preview,
  action,
  actionDelay = 0,
}: OverviewEmptyPreviewProps): JSX.Element {
  const reduced = useReducedMotion() ?? false;
  return (
    <OverviewListingTableCard>
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-8 px-6 py-12">
        <div className="mx-auto w-full max-w-2xl">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{title}</h2>
            {description ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {description}
              </p>
            ) : null}
            {bullets && bullets.length > 0 ? (
              <ul className="mt-4 flex flex-col gap-3">
                {bullets.map(({ icon: Icon, term, text }) => (
                  <li key={term} className="flex items-start gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                      <Icon className="size-4" />
                    </span>
                    <span className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {term}
                      </span>{' '}
                      — {text}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="mt-10">{preview}</div>
          {action ? (
            <motion.div
              className="mt-6 flex justify-end"
              initial={reduced || !actionDelay ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: actionDelay, duration: 0.4 }}
            >
              {action}
            </motion.div>
          ) : null}
        </div>
      </div>
    </OverviewListingTableCard>
  );
}
