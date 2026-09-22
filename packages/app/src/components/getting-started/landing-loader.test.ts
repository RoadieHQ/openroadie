import { afterEach, describe, expect, it } from 'vitest';
import { landingLoader } from './landing-loader';
import { ONBOARDING_DISMISSED_STORAGE_KEY } from './use-onboarding-dismissed';

afterEach(() => {
  window.localStorage.clear();
});

describe('landingLoader', () => {
  it('redirects returning users to the datastore before the lazy route mounts', () => {
    window.localStorage.setItem(
      ONBOARDING_DISMISSED_STORAGE_KEY,
      JSON.stringify(true),
    );

    const result = landingLoader();

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).headers.get('Location')).toBe('/datastore');
  });

  it('leaves first-run users on the index route so progress can decide', () => {
    expect(landingLoader()).toBeNull();
  });
});
