import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@roadiehq/ui/utils';

export interface StatBadge {
  /** Stable key + caption below the value, e.g. "Objects". */
  label: string;
  /** The headline figure, e.g. a count. */
  value: ReactNode;
  icon?: ReactNode;
  /** When set, the whole tile becomes a router link. */
  href?: string;
}

export interface StatBadgesProps {
  stats: StatBadge[];
  className?: string;
}

const TILE_CLASS =
  'flex min-w-0 flex-col gap-0.5 rounded-md border border-divider bg-surface px-3 py-2';

function StatTile({ stat }: { stat: StatBadge }) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-lg leading-none font-semibold text-surface-foreground">
        {stat.icon}
        {stat.value}
      </span>
      <span className="truncate text-xs text-muted-foreground">
        {stat.label}
      </span>
    </>
  );

  if (stat.href) {
    return (
      <Link
        to={stat.href}
        className={cn(
          TILE_CLASS,
          'motion-colors hover:border-border hover:bg-accent',
        )}
      >
        {body}
      </Link>
    );
  }
  return <div className={TILE_CLASS}>{body}</div>;
}

/**
 * A responsive row of stat tiles (counts / summary figures) for the top of a
 * detail drawer. Tiles with an `href` link out to the relevant listing.
 */
export function StatBadges({ stats, className }: StatBadgesProps) {
  if (stats.length === 0) {
    return null;
  }
  return (
    <div className={cn('grid grid-cols-2 gap-2 sm:grid-cols-3', className)}>
      {stats.map(stat => (
        <StatTile key={stat.label} stat={stat} />
      ))}
    </div>
  );
}
