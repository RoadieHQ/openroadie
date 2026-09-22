import React from 'react';
import { IntegrationIconFrame } from '@roadiehq/ui/item-list';
import type { IntegrationIconFrameSize } from '@roadiehq/ui/item-list';
import { cn } from '@roadiehq/ui/utils';
import type { Workspace } from '../../api';

/** The product mark, shown for a workspace that has uploaded none. Unlike a
 *  stored SVG — which renders inside an `<img>` and so cannot inherit page
 *  colour — this one tracks the theme's brand token. */
export function FallbackWorkspaceMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={cn('h-full w-full', className)}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="-35 0 516 516"
    >
      <path
        className="fill-brand"
        d="M222.872 450.134V430.104L446.087 301.553L388.74 268.489L222.872 363.976V344.015L444.784 216.15L387.505 183.086L222.872 277.887V257.857L446.773 128.894L222.872 0L0 128.894V386.819L222.872 515.713L446.773 386.819L389.838 353.961L222.872 450.134Z"
      />
    </svg>
  );
}

export function workspaceMarkDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export interface WorkspaceMarkProps {
  workspace: Pick<Workspace, 'name' | 'svg'>;
  size?: IntegrationIconFrameSize;
  well?: boolean;
  className?: string;
}

/**
 * A workspace's square mark. Stored SVG goes through a `data:` URL in an
 * `<img>` — the same path integration logos take — which neither executes
 * script nor issues requests, so uploaded markup never becomes live DOM.
 */
export function WorkspaceMark({
  workspace,
  size = 'compact',
  well = true,
  className,
}: WorkspaceMarkProps) {
  return (
    <IntegrationIconFrame size={size} well={well} className={className}>
      {workspace.svg ? (
        <img
          src={workspaceMarkDataUrl(workspace.svg)}
          alt=""
          className="h-full w-full object-contain"
        />
      ) : (
        <FallbackWorkspaceMark />
      )}
    </IntegrationIconFrame>
  );
}
