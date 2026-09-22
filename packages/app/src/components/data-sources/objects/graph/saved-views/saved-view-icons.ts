import { Atom, Compass, Orbit, Radar, Route, Satellite } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const SAVED_GRAPH_VIEW_ICON_KEYS = [
  'atom',
  'compass',
  'orbit',
  'radar',
  'route',
  'satellite',
] as const;

export type SavedGraphViewIconKey = (typeof SAVED_GRAPH_VIEW_ICON_KEYS)[number];

const ICON_BY_KEY = new Map<SavedGraphViewIconKey, LucideIcon>([
  ['atom', Atom],
  ['compass', Compass],
  ['orbit', Orbit],
  ['radar', Radar],
  ['route', Route],
  ['satellite', Satellite],
]);

export function savedGraphViewIconForKey(
  iconKey?: SavedGraphViewIconKey,
): LucideIcon {
  return (iconKey && ICON_BY_KEY.get(iconKey)) || Orbit;
}

export function pickRandomSavedGraphViewIconKey(): SavedGraphViewIconKey {
  const index = Math.floor(Math.random() * SAVED_GRAPH_VIEW_ICON_KEYS.length);
  return SAVED_GRAPH_VIEW_ICON_KEYS.at(index) ?? 'orbit';
}
