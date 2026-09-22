export interface WarmupPriority {
  run<T>(task: () => Promise<T>): Promise<T>;
}

export interface ForegroundAwareWarmupPriority extends WarmupPriority {
  setForegroundActive(active: boolean): void;
}

export function createWarmupPriority(): ForegroundAwareWarmupPriority {
  let foregroundActive = false;
  let resume: (() => void) | undefined;
  let foregroundIdle = Promise.resolve();

  return {
    setForegroundActive(active) {
      if (active === foregroundActive) {
        return;
      }
      foregroundActive = active;
      if (active) {
        foregroundIdle = new Promise(resolve => {
          resume = resolve;
        });
      } else {
        resume?.();
        resume = undefined;
      }
    },
    async run<T>(task: () => Promise<T>) {
      while (foregroundActive) {
        await foregroundIdle;
      }
      return task();
    },
  };
}
