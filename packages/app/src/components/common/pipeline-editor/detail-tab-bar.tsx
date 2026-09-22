import { TabsList, TabsTrigger } from '@roadiehq/ui/tabs';
import { cn } from '@roadiehq/ui/utils';

export interface DetailTab {
  id: string;
  label: string;
}

/**
 * The details-panel tab row for the pipeline editors, built on the Radix-backed
 * `Tabs` primitive (so it gets tablist/tab roles + arrow-key navigation for
 * free) but restyled to the editors' underline look instead of the default
 * pill. Render it inside a `<Tabs value onValueChange>` alongside the matching
 * `<TabsContent>` panels.
 */
export function DetailTabBar({ tabs }: { tabs: DetailTab[] }) {
  return (
    <TabsList className="flex h-auto min-h-[40px] w-full justify-start rounded-none border-b border-border bg-transparent p-0 px-2 text-muted-foreground">
      {tabs.map(tab => (
        <TabsTrigger
          key={tab.id}
          value={tab.id}
          className={cn(
            'motion-colors relative h-auto min-h-[40px] rounded-none border-0 bg-transparent px-3 py-2 text-sm font-medium text-muted-foreground shadow-none',
            'hover:text-foreground',
            'data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none',
            "after:absolute after:inset-x-0 after:bottom-0 after:h-[2px] after:bg-transparent after:content-['']",
            'data-[state=active]:after:bg-primary',
          )}
        >
          {tab.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}
