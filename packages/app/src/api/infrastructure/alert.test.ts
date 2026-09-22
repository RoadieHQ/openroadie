import { toast } from '@roadiehq/ui/toaster';
import { AlertApiImpl } from './alert';

vi.mock('@roadiehq/ui/toaster', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

describe('AlertApiImpl', () => {
  beforeEach(() => {
    for (const fn of Object.values(toast) as unknown as Array<{
      mockReset: () => void;
    }>) {
      fn.mockReset();
    }
  });

  it('posts success messages via toast.success', () => {
    new AlertApiImpl().post({ message: 'saved', severity: 'success' });
    expect(toast.success).toHaveBeenCalledWith('saved', undefined);
  });

  it('posts error messages via toast.error', () => {
    new AlertApiImpl().post({ message: 'boom', severity: 'error' });
    expect(toast.error).toHaveBeenCalledWith('boom', undefined);
  });

  it('defaults to toast.info when severity is missing', () => {
    new AlertApiImpl().post({ message: 'fyi' });
    expect(toast.info).toHaveBeenCalledWith('fyi', undefined);
  });

  it('treats display=permanent as infinite duration', () => {
    new AlertApiImpl().post({
      message: 'stay',
      severity: 'warning',
      display: 'permanent',
    });
    expect(toast.warning).toHaveBeenCalledWith('stay', {
      duration: Infinity,
    });
  });
});
