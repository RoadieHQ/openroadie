export const APP_WARMUP_PREFERENCE_KEY = 'openroadie:app-warmup';

export type AppWarmupPreference = 'auto' | 'off' | 'full';
export type AppWarmupTier = 'off' | 'primary' | 'full';

export interface AppWarmupSignals {
  preference: AppWarmupPreference;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  saveData?: boolean;
  effectiveType?: string;
}

export function resolveAppWarmupTier({
  preference,
  deviceMemory,
  hardwareConcurrency,
  saveData,
  effectiveType,
}: AppWarmupSignals): AppWarmupTier {
  if (preference === 'off') {
    return 'off';
  }
  if (preference === 'full') {
    return 'full';
  }
  if (
    saveData ||
    effectiveType === 'slow-2g' ||
    effectiveType === '2g' ||
    (deviceMemory !== undefined && deviceMemory <= 2) ||
    (hardwareConcurrency !== undefined && hardwareConcurrency <= 2)
  ) {
    return 'off';
  }
  if (
    deviceMemory !== undefined &&
    deviceMemory >= 8 &&
    hardwareConcurrency !== undefined &&
    hardwareConcurrency >= 8 &&
    (effectiveType === undefined || effectiveType === '4g')
  ) {
    return 'full';
  }
  return 'primary';
}

export function getAppWarmupPreference(): AppWarmupPreference {
  try {
    const preference = window.localStorage.getItem(APP_WARMUP_PREFERENCE_KEY);
    if (preference === 'off' || preference === 'full') {
      return preference;
    }
  } catch {
    return 'auto';
  }
  return 'auto';
}

export function setAppWarmupPreference(preference: AppWarmupPreference) {
  if (preference === 'auto') {
    window.localStorage.removeItem(APP_WARMUP_PREFERENCE_KEY);
    return;
  }
  window.localStorage.setItem(APP_WARMUP_PREFERENCE_KEY, preference);
}

export function getAppWarmupTier(): AppWarmupTier {
  const connection = Reflect.get(navigator, 'connection');
  return resolveAppWarmupTier({
    preference: getAppWarmupPreference(),
    deviceMemory:
      typeof Reflect.get(navigator, 'deviceMemory') === 'number'
        ? Reflect.get(navigator, 'deviceMemory')
        : undefined,
    hardwareConcurrency:
      navigator.hardwareConcurrency > 0
        ? navigator.hardwareConcurrency
        : undefined,
    saveData:
      typeof connection === 'object' && connection !== null
        ? Reflect.get(connection, 'saveData') === true
        : undefined,
    effectiveType:
      typeof connection === 'object' &&
      connection !== null &&
      typeof Reflect.get(connection, 'effectiveType') === 'string'
        ? Reflect.get(connection, 'effectiveType')
        : undefined,
  });
}
