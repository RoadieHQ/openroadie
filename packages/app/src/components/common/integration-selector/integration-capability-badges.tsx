import React from 'react';
import { Badge } from '@roadiehq/ui/badge';
import { Tooltip, TooltipTrigger, TooltipContent } from '@roadiehq/ui/tooltip';
import type { Integration } from '../../integrations/types';

interface IntegrationCapabilityBadgesProps {
  integration: Integration;
}

const badgeClass =
  'px-1 py-0 font-mono text-[10px] font-medium leading-4 ' +
  'text-muted-foreground border-muted-foreground/20 opacity-70';

export function IntegrationCapabilityBadges({
  integration,
}: IntegrationCapabilityBadgesProps) {
  const supportsRest = integration.backendType === 'http';
  const supportsGraphql = supportsRest && Boolean(integration.graphqlPath);

  if (!supportsRest && !supportsGraphql) return null;

  return (
    <span className="flex items-center gap-1">
      {supportsGraphql && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className={badgeClass}>
              GraphQL
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Supports GraphQL</TooltipContent>
        </Tooltip>
      )}
      {supportsRest && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className={badgeClass}>
              REST
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Supports REST</TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}
