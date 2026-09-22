import React from 'react';
import { cva } from 'class-variance-authority';
import { LoaderCircle, type LucideIcon } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { cn } from '@roadiehq/ui/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@roadiehq/ui/tooltip';
import { NavigationIntentLink } from '../common/navigation-intent-link';

export const sidebarNavItemVariants = cva(
  'group relative flex h-8 w-full cursor-pointer items-center rounded-md text-sm font-medium outline-none motion-sidebar-item focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar',
  {
    variants: {
      active: {
        true: 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm',
        false:
          'text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground',
      },
      collapsed: {
        true: 'justify-center px-0',
        false: 'gap-2.5 px-2.5',
      },
    },
    defaultVariants: {
      active: false,
      collapsed: false,
    },
  },
);

type SidebarNavItemProps = {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  collapsed: boolean;
  pending?: boolean;
} & (
  | { to: string; href?: never; onClick?: never }
  | { to?: never; href: string; onClick?: never }
  | { to?: never; href?: never; onClick: () => void }
);

export function SidebarNavItem({
  icon: Icon,
  label,
  active = false,
  collapsed,
  pending = false,
  to,
  href,
  onClick,
}: SidebarNavItemProps) {
  const className = sidebarNavItemVariants({ active, collapsed });
  const ariaCurrent = active ? 'page' : undefined;

  const inner = (
    <>
      {active && !collapsed ? (
        <span
          aria-hidden
          className="absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-sidebar-primary"
        />
      ) : null}
      {pending ? (
        <LoaderCircle className="motion-icon-spin size-[18px] shrink-0 text-sidebar-primary" />
      ) : (
        <Icon
          className={cn(
            'motion-colors size-[18px] shrink-0',
            active ? 'text-sidebar-primary' : 'text-sidebar-foreground/55',
          )}
        />
      )}
      {!collapsed ? (
        <span className="overflow-hidden leading-none text-ellipsis whitespace-nowrap">
          {label}
        </span>
      ) : null}
    </>
  );

  const content = to ? (
    <NavigationIntentLink
      to={to}
      aria-label={collapsed ? label : undefined}
      aria-busy={pending || undefined}
      aria-current={ariaCurrent}
      className={className}
    >
      {inner}
    </NavigationIntentLink>
  ) : onClick ? (
    <Button
      type="button"
      variant="sidebar"
      size={null}
      aria-label={collapsed ? label : undefined}
      onClick={onClick}
      className={className}
    >
      {inner}
    </Button>
  ) : (
    <a
      href={href}
      aria-label={collapsed ? label : undefined}
      aria-current={ariaCurrent}
      className={className}
    >
      {inner}
    </a>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right" className="font-medium">
          {label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
}
