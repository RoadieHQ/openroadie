import { useEffect, useMemo } from 'react';
import { Link } from 'react-router';
import { Database, ExternalLink, X } from 'lucide-react';
import { cn } from '@roadiehq/ui/utils';
import { Button } from '@roadiehq/ui/button';
import { Separator } from '@roadiehq/ui/separator';
import { IntegrationLogo } from '@roadiehq/ui/item-list';
import type { RelationshipRule } from '../../../api/datastore/datastore-client';
import type { DataSourceItem } from '../types';
import { dataSourceDetail } from '../../../config/paths';
import { DetailSection } from '../../common';
import { OverviewStatusCell } from '../../overview';
import {
  MetadataRow,
  RelationshipRow,
  formatTimestamp,
} from './inspector-shared';

interface ReadOnlyDataSourceInspectorProps {
  open: boolean;
  dataSource: DataSourceItem | undefined;
  fallbackId: string;
  rules: RelationshipRule[];
  datasourceLabels: ReadonlyMap<string, string>;
  onClose: () => void;
}

export function ReadOnlyDataSourceInspector({
  open,
  dataSource,
  fallbackId,
  rules,
  datasourceLabels,
  onClose,
}: ReadOnlyDataSourceInspectorProps) {
  const id = dataSource?.id ?? fallbackId;
  const name = dataSource?.name ?? fallbackId;
  const logoUrl = dataSource?.logoUrl;
  const enabled = dataSource?.enabled;
  const objectCount = dataSource?.execution?.objectCount;
  const lastRunAt = formatTimestamp(dataSource?.execution?.lastRunAt);

  const { outbound, inbound } = useMemo(() => {
    const out: RelationshipRule[] = [];
    const inb: RelationshipRule[] = [];
    for (const rule of rules) {
      if (rule.state === 'inactive') continue;
      if (rule.sourceDatasourceId === id) out.push(rule);
      else if (rule.targetDatasourceId === id) inb.push(rule);
    }
    return { outbound: out, inbound: inb };
  }, [rules, id]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  return (
    <div
      className={cn(
        'motion-panel absolute top-0 right-0 z-overlay flex h-full w-[440px] flex-col border-l border-border bg-card shadow-lg',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
      // `region` (rather than `dialog`) — this panel is non-modal: no focus
      // trap, no backdrop, the canvas remains interactive. `inert` + `aria-hidden`
      // when closed prevent the off-screen content from being announced or
      // tabbed into.
      role="region"
      aria-label="Data source details"
      aria-hidden={!open}
      inert={!open}
    >
      <div className="flex items-start gap-2 px-4 pt-3 pb-2">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background">
          {logoUrl ? (
            <IntegrationLogo src={logoUrl} size={18} />
          ) : (
            <Database className="size-4 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">
            {name}
          </div>
          <div className="mt-0.5">
            {dataSource ? (
              <OverviewStatusCell
                expanded
                tone={enabled ? 'success' : 'muted'}
                label={enabled ? 'Enabled' : 'Disabled'}
              />
            ) : (
              <span className="text-2xs text-muted-foreground">Unknown</span>
            )}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 opacity-60 hover:opacity-100"
          title="Close"
          onClick={onClose}
        >
          <X className="size-4" />
        </Button>
      </div>

      <Separator />

      <div className="flex flex-1 flex-col gap-3 overflow-auto px-4 py-4">
        <Button
          asChild
          variant="outline"
          size="sm"
          className="h-7 w-full justify-between text-xs"
        >
          <Link to={dataSourceDetail(id)}>
            Open data source
            <ExternalLink className="size-3" />
          </Link>
        </Button>

        <DetailSection title="Stats">
          <div>
            <MetadataRow label="Objects">
              {typeof objectCount === 'number'
                ? objectCount.toLocaleString()
                : '—'}
            </MetadataRow>
            <MetadataRow label="Last run">{lastRunAt ?? '—'}</MetadataRow>
            <MetadataRow label="Relationships">
              {outbound.length + inbound.length}
            </MetadataRow>
          </div>
        </DetailSection>

        <DetailSection title="Outbound" count={outbound.length}>
          {outbound.length === 0 ? (
            <div className="text-2xs text-muted-foreground">
              No outbound relationships.
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {outbound.map(rule => (
                <RelationshipRow
                  key={rule.id}
                  direction="outbound"
                  otherLabel={
                    datasourceLabels.get(rule.targetDatasourceId) ??
                    rule.targetDatasourceId
                  }
                  relationshipType={rule.relationshipType}
                />
              ))}
            </div>
          )}
        </DetailSection>

        <DetailSection title="Inbound" count={inbound.length}>
          {inbound.length === 0 ? (
            <div className="text-2xs text-muted-foreground">
              No inbound relationships.
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {inbound.map(rule => (
                <RelationshipRow
                  key={rule.id}
                  direction="inbound"
                  otherLabel={
                    datasourceLabels.get(rule.sourceDatasourceId) ??
                    rule.sourceDatasourceId
                  }
                  relationshipType={rule.relationshipType}
                />
              ))}
            </div>
          )}
        </DetailSection>
      </div>
    </div>
  );
}
