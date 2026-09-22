import { render } from '@testing-library/react';
import { OverviewListingPageHeaderSkeleton } from './overview-listing-header-skeleton';

describe('OverviewListingPageHeaderSkeleton', () => {
  it('renders valid header placeholder markup', () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    try {
      render(<OverviewListingPageHeaderSkeleton />);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
