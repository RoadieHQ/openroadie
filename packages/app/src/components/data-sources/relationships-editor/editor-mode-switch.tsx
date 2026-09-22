import { Pencil, Wand2 } from 'lucide-react';
import { ToggleGroup } from '@roadiehq/ui/toggle-group';
import { cn } from '@roadiehq/ui/utils';
import type { EditorMode } from './editor-mode';

interface EditorModeSwitchProps {
  value: EditorMode;
  onChange: (next: EditorMode) => void;
  className?: string;
}

// Top-level modes shown in the toggle group.
const ITEMS: {
  value: EditorMode;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { value: 'edit', label: 'Edit', icon: Pencil },
  { value: 'suggest', label: 'Suggest', icon: Wand2 },
];

export function EditorModeSwitch({
  value,
  onChange,
  className,
}: EditorModeSwitchProps) {
  return (
    <ToggleGroup
      value={value}
      // Clicking the active mode closes it and returns to the default
      // edit mode.
      onValueChange={next => onChange(next === value ? 'edit' : next)}
      items={ITEMS.map(item => ({ ...item, tooltip: item.label }))}
      orientation="vertical"
      appearance="pills"
      aria-label="Editor mode"
      className={cn('items-center', className)}
    />
  );
}
