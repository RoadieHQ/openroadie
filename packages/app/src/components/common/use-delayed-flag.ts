import { useEffect, useRef, useState } from 'react';

export interface DelayedFlagOptions {
  /** Wait this long before turning true — quick loads never trip it, so a
   * skeleton that would only flash for a moment is skipped entirely. */
  delayMs?: number;
  /** Once true, stay true at least this long — so a skeleton that does show
   * never blinks out after a few frames. */
  minVisibleMs?: number;
}

/**
 * Anti-flicker gate for loading skeletons. Returns `true` only after `active`
 * has stayed true for `delayMs`, and once `true` keeps returning `true` for at
 * least `minVisibleMs`. Net effect: fast loads show no skeleton at all, and a
 * skeleton that does appear is on screen long enough to read as intentional
 * rather than a flicker. See `.claude/rules/loading-states.md`.
 */
export function useDelayedFlag(
  active: boolean,
  { delayMs = 150, minVisibleMs = 300 }: DelayedFlagOptions = {},
): boolean {
  const [visible, setVisible] = useState(false);
  const shownAtRef = useRef(0);

  useEffect(() => {
    if (active) {
      if (visible) {
        return;
      }
      const showTimer = setTimeout(() => {
        shownAtRef.current = Date.now();
        setVisible(true);
      }, delayMs);
      return () => clearTimeout(showTimer);
    }

    // `active` is false: if the skeleton never showed, do nothing; otherwise
    // hold it until the minimum-visible window has elapsed.
    if (!visible) {
      return;
    }
    const remaining = minVisibleMs - (Date.now() - shownAtRef.current);
    if (remaining <= 0) {
      setVisible(false);
      return;
    }
    const hideTimer = setTimeout(() => setVisible(false), remaining);
    return () => clearTimeout(hideTimer);
  }, [active, visible, delayMs, minVisibleMs]);

  return visible;
}
