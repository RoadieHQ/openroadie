import React, { useCallback, useMemo, useState } from 'react';
import { Blocks } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@roadiehq/ui/popover';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@roadiehq/ui/tooltip';
import { Button } from '@roadiehq/ui/button';
import { IntegrationIconFrame } from '@roadiehq/ui/item-list';
import { cn } from '@roadiehq/ui/utils';
import type { LogoEntry } from '../../../api/workflow/workflow-client';

interface LogoPickerProps {
  value: string;
  onChange: (slug: string) => void;
  disabled?: boolean;
  logos: LogoEntry[];
  /** Mount popover inside this element so the list scrolls inside a modal dialog */
  popoverContainer?: HTMLElement | null;
}

/** Vendor / product marks vs generic monochrome glyphs.
 * Brand SVGs are either Simple-Icons style (`role="img"`) or carry an
 * explicit hex/rgb fill; generic icons inherit from `currentColor`.
 */
export function isBrandLogo(entry: LogoEntry): boolean {
  return (
    entry.svg.includes('role="img"') ||
    entry.svg.includes('fill="#') ||
    entry.svg.includes('fill="rgb')
  );
}

const LogoTile = React.memo(function LogoTile({
  logo,
  value,
  disabled,
  onPickSlug,
}: {
  logo: LogoEntry;
  value: string;
  disabled: boolean;
  onPickSlug: (slug: string) => void;
}) {
  const isSelected = value === logo.slug;
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    logo.svg,
  )}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onPickSlug(isSelected ? '' : logo.slug)}
          disabled={disabled}
          className={cn(
            'motion-colors size-9 rounded border-2 p-0 hover:border-primary',
            isSelected
              ? 'border-primary bg-disabled'
              : 'border-divider bg-transparent',
          )}
        >
          <IntegrationIconFrame size="mini">
            <img
              src={src}
              alt={logo.label}
              width={20}
              height={20}
              className="h-full w-full object-contain"
            />
          </IntegrationIconFrame>
        </Button>
      </TooltipTrigger>
      <TooltipContent className="pointer-events-none">
        {logo.label}
      </TooltipContent>
    </Tooltip>
  );
});

export function LogoPicker({
  value,
  onChange,
  disabled = false,
  logos,
  popoverContainer = null,
}: LogoPickerProps) {
  const [open, setOpen] = useState(false);

  const { brandLogos, symbolLogos, logoBySlug } = useMemo(() => {
    const brands: LogoEntry[] = [];
    const symbols: LogoEntry[] = [];
    const bySlug = new Map<string, LogoEntry>();
    for (const logo of logos) {
      bySlug.set(logo.slug, logo);
      (isBrandLogo(logo) ? brands : symbols).push(logo);
    }
    return { brandLogos: brands, symbolLogos: symbols, logoBySlug: bySlug };
  }, [logos]);

  const { selected, selectedSrc } = useMemo(() => {
    const entry = logoBySlug.get(value);
    return {
      selected: entry,
      selectedSrc: entry
        ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(entry.svg)}`
        : undefined,
    };
  }, [logoBySlug, value]);

  const pickLogoSlug = useCallback(
    (slug: string) => {
      onChange(slug);
      setOpen(false);
    },
    [onChange],
  );

  return (
    <Popover
      open={disabled ? false : open}
      onOpenChange={nextOpen => {
        if (!disabled) {
          setOpen(nextOpen);
        }
      }}
    >
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-full min-h-0 w-full min-w-0 shrink-0 rounded-sm p-0 hover:bg-muted/50"
                disabled={disabled}
                aria-label="Choose integration logo"
              >
                {selectedSrc ? (
                  <IntegrationIconFrame size="mini">
                    <img
                      src={selectedSrc}
                      alt={selected?.label}
                      width={20}
                      height={20}
                      className="h-full w-full object-contain"
                    />
                  </IntegrationIconFrame>
                ) : (
                  <Blocks className="size-5 text-muted-foreground" />
                )}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Pick logo</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <PopoverContent
        container={popoverContainer}
        className={cn(
          'z-[100] flex max-h-[min(22rem,70dvh)] min-h-0 w-[280px] flex-col gap-0 overflow-hidden p-0 shadow-md',
        )}
        align="start"
        sideOffset={6}
        collisionPadding={16}
        onOpenAutoFocus={e => e.preventDefault()}
        onCloseAutoFocus={e => e.preventDefault()}
        onWheel={e => e.stopPropagation()}
      >
        <TooltipProvider delayDuration={300} disableHoverableContent>
          <div
            className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain p-3"
            onWheel={e => e.stopPropagation()}
          >
            <div className="flex flex-col gap-3">
              {brandLogos.length > 0 && (
                <section
                  className="min-w-0"
                  aria-labelledby="logo-picker-brands"
                >
                  <h3
                    id="logo-picker-brands"
                    className="mb-2 border-b border-divider pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
                  >
                    Logos
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {brandLogos.map(logo => (
                      <LogoTile
                        key={logo.slug}
                        logo={logo}
                        value={value}
                        disabled={disabled}
                        onPickSlug={pickLogoSlug}
                      />
                    ))}
                  </div>
                </section>
              )}
              {symbolLogos.length > 0 && (
                <section
                  className="min-w-0"
                  aria-labelledby="logo-picker-icons"
                >
                  <h3
                    id="logo-picker-icons"
                    className="mb-2 border-b border-divider pb-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
                  >
                    Icons
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {symbolLogos.map(logo => (
                      <LogoTile
                        key={logo.slug}
                        logo={logo}
                        value={value}
                        disabled={disabled}
                        onPickSlug={pickLogoSlug}
                      />
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        </TooltipProvider>
      </PopoverContent>
    </Popover>
  );
}
