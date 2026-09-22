import { afterEach, describe, expect, it } from 'vitest';
import {
  APP_WARMUP_PREFERENCE_KEY,
  getAppWarmupPreference,
  resolveAppWarmupTier,
  setAppWarmupPreference,
} from './app-warmup-policy';

afterEach(() => {
  window.localStorage.clear();
});

describe('resolveAppWarmupTier', () => {
  it('turns warming off for constrained devices and networks', () => {
    expect(
      resolveAppWarmupTier({
        preference: 'auto',
        deviceMemory: 2,
        hardwareConcurrency: 2,
        effectiveType: '2g',
      }),
    ).toBe('off');
    expect(
      resolveAppWarmupTier({
        preference: 'auto',
        deviceMemory: 8,
        hardwareConcurrency: 8,
        saveData: true,
      }),
    ).toBe('off');
  });

  it('warms primary routes on a normal device', () => {
    expect(
      resolveAppWarmupTier({
        preference: 'auto',
        deviceMemory: 4,
        hardwareConcurrency: 4,
        effectiveType: '4g',
      }),
    ).toBe('primary');
  });

  it('warms the full app on a capable device', () => {
    expect(
      resolveAppWarmupTier({
        preference: 'auto',
        deviceMemory: 8,
        hardwareConcurrency: 8,
        effectiveType: '4g',
      }),
    ).toBe('full');
  });

  it('respects explicit off and full preferences', () => {
    expect(
      resolveAppWarmupTier({
        preference: 'off',
        deviceMemory: 16,
        hardwareConcurrency: 16,
      }),
    ).toBe('off');
    expect(
      resolveAppWarmupTier({
        preference: 'full',
        deviceMemory: 2,
        hardwareConcurrency: 2,
        saveData: true,
      }),
    ).toBe('full');
  });
});

describe('app warmup preference', () => {
  it('stores explicit preferences and removes the automatic override', () => {
    setAppWarmupPreference('full');
    expect(getAppWarmupPreference()).toBe('full');

    setAppWarmupPreference('off');
    expect(getAppWarmupPreference()).toBe('off');

    setAppWarmupPreference('auto');
    expect(getAppWarmupPreference()).toBe('auto');
    expect(window.localStorage.getItem(APP_WARMUP_PREFERENCE_KEY)).toBeNull();
  });
});
