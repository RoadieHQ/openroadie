import { useEffect, useState } from 'react';
import type React from 'react';
import type { FooterHint } from './types';

export function useRevealCount(total: number, intervalMs = 70) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    setCount(0);
    const timer = setInterval(() => {
      setCount(current => {
        if (current >= total) {
          clearInterval(timer);
          return current;
        }
        return current + 1;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [intervalMs, total]);

  return count;
}

export function useFooter(
  setFooterHints: React.Dispatch<React.SetStateAction<FooterHint[]>>,
  hints: FooterHint[],
) {
  useEffect(() => {
    setFooterHints(hints);
  }, [hints, setFooterHints]);
}
