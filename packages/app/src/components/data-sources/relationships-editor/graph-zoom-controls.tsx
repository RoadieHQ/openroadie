import { Panel, useReactFlow } from '@xyflow/react';
import { Plus, Minus, Frame } from 'lucide-react';
import { Button } from '@roadiehq/ui/button';
import { Card } from '@roadiehq/ui/card';
import { RELATIONSHIP_FOCUS_DURATION_MS } from './use-relationship-viewport-focus';

// Zoom / fit-view controls on the shared `Card variant="floating"` shell, so
// every floating panel reads as one system. Replaces React Flow's default
// <Controls>, whose markup we can't reliably restyle to match.
const BUTTON_CLASS =
  'size-8 rounded-lg text-muted-foreground hover:bg-accent hover:text-accent-foreground';

export function GraphZoomControls() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  return (
    <Panel position="bottom-left">
      <Card
        variant="floating"
        className="flex flex-col items-center gap-1 p-1.5"
      >
        <Button
          variant="ghost"
          size="icon"
          className={BUTTON_CLASS}
          aria-label="Zoom in"
          onClick={() => void zoomIn()}
        >
          <Plus className="size-icon" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={BUTTON_CLASS}
          aria-label="Zoom out"
          onClick={() => void zoomOut()}
        >
          <Minus className="size-icon" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={BUTTON_CLASS}
          aria-label="Fit view"
          onClick={() =>
            void fitView({
              padding: 0.2,
              duration: RELATIONSHIP_FOCUS_DURATION_MS,
            })
          }
        >
          <Frame className="size-icon" />
        </Button>
      </Card>
    </Panel>
  );
}
