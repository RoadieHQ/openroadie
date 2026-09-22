import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { Card, CardContent } from '@roadiehq/ui/card';
import { IntegrationIconFrame, IntegrationLogo } from '@roadiehq/ui/item-list';
import type { IntegrationItem } from '../types';

/** Curated "start here" integrations, most-common first. Presence in the
 *  catalog is still required — a slug not installed in this deployment is
 *  silently skipped. */
const RECOMMENDED_SLUGS = ['github-token', 'gitlab', 'pagerduty'] as const;

/**
 * A slim "connect your first" strip shown atop the Integrations list for a
 * newcomer (no integration configured yet). It gives the 40+ undifferentiated
 * pre-built rows a recommended starting point instead of a flat wall (fixes
 * onboarding gap G4). Renders nothing once anything is connected or none of the
 * curated integrations exist here — the caller also gates on those, but the
 * component stays safe on its own.
 */
export function RecommendedIntegrationsStrip({
  integrations,
  onConnect,
}: {
  integrations: IntegrationItem[];
  onConnect: (id: string) => void;
}) {
  const recommended = useMemo(() => {
    const bySlug = new Map(integrations.map(item => [item.slug, item]));
    return RECOMMENDED_SLUGS.map(slug => bySlug.get(slug)).filter(
      (item): item is IntegrationItem => item !== undefined,
    );
  }, [integrations]);

  if (recommended.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm font-medium text-foreground">
          Connect your first integration
        </p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Configuring an integration adds its data sources for you — the fastest
          way to get data flowing.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {recommended.map(item => (
            <Button
              key={item.id}
              type="button"
              variant="outline"
              onClick={() => onConnect(item.id)}
              className="h-auto gap-2.5 rounded-lg border-border/60 px-3 py-2 hover:border-border hover:bg-accent/50"
            >
              <IntegrationIconFrame size="group">
                <IntegrationLogo src={item.logoUrl} size={16} />
              </IntegrationIconFrame>
              <span className="text-[13px] font-medium text-foreground">
                {item.name}
              </span>
              <ArrowRight className="size-3.5 text-muted-foreground" />
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
