import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@roadiehq/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@roadiehq/ui/tooltip';

export interface ConfigTab {
  value: string;
  /** Accessible name + tooltip; the trigger itself shows only the icon. */
  label: string;
  icon: ReactNode;
  content: ReactNode;
}

/**
 * A config card's tabs as a vertical rail of icon buttons on the left, content
 * on the right — trades a horizontal tab strip's height for a slim icon column,
 * so the card stays short. Each icon carries its label as a tooltip + aria-label.
 */
export function ConfigTabs({
  tabs,
  defaultValue,
  ariaLabel,
}: {
  tabs: ConfigTab[];
  defaultValue?: string;
  ariaLabel: string;
}) {
  return (
    // min-h-full lets the rail fill the panel even when the content is shorter.
    <Tabs
      defaultValue={defaultValue ?? tabs[0]?.value}
      orientation="vertical"
      className="flex min-h-full items-stretch gap-3"
    >
      <TooltipProvider delayDuration={0}>
        <TabsList
          aria-label={ariaLabel}
          // A darker side strip that runs the full height of the config panel
          // and sits flush against its top/bottom/left edges. The negative
          // margins cancel the panel's own padding (py-4 pl-2 in
          // relationship-step-list's step body) — ConfigTabs is only rendered
          // inside that panel. justify-start pins the icons to the top since the
          // base TabsList centers along the (now vertical) main axis.
          className="-my-4 -ml-2 h-auto shrink-0 flex-col justify-start gap-0.5 self-stretch rounded-l-lg rounded-r-none border-0 border-r border-border/60 bg-background px-1.5 py-3"
        >
          {tabs.map(tab => (
            <Tooltip key={tab.value}>
              <TooltipTrigger asChild>
                <TabsTrigger
                  value={tab.value}
                  aria-label={tab.label}
                  // Active styling keys off aria-selected, not data-state: this
                  // trigger is also a TooltipTrigger (asChild), and Radix
                  // Tooltip's data-state (open/closed) clobbers Tabs' on the
                  // merged element, so data-[state=active] would never match.
                  className="size-7 rounded-md border border-transparent p-0 text-muted-foreground shadow-none hover:text-foreground aria-selected:border-border aria-selected:bg-muted aria-selected:text-foreground aria-selected:shadow-none [&_svg]:size-4"
                >
                  {tab.icon}
                </TabsTrigger>
              </TooltipTrigger>
              <TooltipContent side="right">{tab.label}</TooltipContent>
            </Tooltip>
          ))}
        </TabsList>
      </TooltipProvider>
      <div className="min-w-0 flex-1">
        {tabs.map(tab => (
          <TabsContent
            key={tab.value}
            value={tab.value}
            className="mt-0 flex flex-col gap-4"
          >
            {tab.content}
          </TabsContent>
        ))}
      </div>
    </Tabs>
  );
}
