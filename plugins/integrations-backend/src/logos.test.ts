import { describe, expect, it } from 'vitest';

import { getLogoList, getLogoSlugBySvg, getLogoSvg } from './logos';

describe('logos', () => {
  it.each([
    ['kubernetes', 'Kubernetes'],
    ['cncf', 'CNCF'],
    ['slack', 'Slack'],
    ['amplitude', 'Amplitude'],
    ['env0', 'env0'],
    ['auth0', 'Auth0'],
    ['grafana', 'Grafana'],
    ['prometheus', 'Prometheus'],
    ['intercom', 'Intercom'],
  ])('includes the %s logo in the catalog', (slug, label) => {
    const svg = getLogoSvg(slug);

    expect(svg).toContain(`<title>${label}</title>`);
    expect(getLogoSlugBySvg(svg ?? '')).toBe(slug);
    expect(getLogoList().some(logo => logo.slug === slug)).toBe(true);
  });

  it('includes the sentry logo in the catalog', () => {
    const svg = getLogoSvg('sentry');

    expect(svg).toContain('<title>Sentry</title>');
    expect(getLogoSlugBySvg(svg!)).toBe('sentry');
    expect(getLogoList().some(logo => logo.slug === 'sentry')).toBe(true);
  });
});
