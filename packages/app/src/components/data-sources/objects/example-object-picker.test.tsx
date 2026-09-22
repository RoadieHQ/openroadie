import { screen, waitFor } from '@testing-library/react';
import { renderWithQuery as render } from '../../../test-utils';

import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExampleObjectPicker } from './example-object-picker';
import type { DataSourceItem } from '../types';

const mockApi = {
  getObject: vi.fn(),
};

vi.mock('../../../api', () => ({
  useDatastore: () => mockApi,
}));

const mockUseDataSourceObjects = vi.fn();
vi.mock('./use-data-source-objects', () => ({
  useDataSourceObjects: (...args: unknown[]) =>
    mockUseDataSourceObjects(...args),
}));

const baseProps = {
  // Only id and name are read by the picker.
  dataSources: [{ id: 'ds-1', name: 'DS One' } as DataSourceItem],
  initialSourceDatasourceId: 'ds-1',
  initialSourceObjectId: 'obj-a',
  candidates: [],
  onInfer: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseDataSourceObjects.mockReturnValue({
    rows: [
      {
        id: 'r1',
        datasourceId: 'ds-1',
        objectId: 'obj-a',
        object: { name: 'A' },
        indexValues: new Map(),
        createdAt: '',
        updatedAt: '',
      },
    ],
    loading: false,
    total: 1,
  });
  mockApi.getObject.mockResolvedValue({
    objectId: 'obj-a',
    object: { name: 'A' },
    relationships: [],
  });
});

describe('ExampleObjectPicker', () => {
  it('clears the target selection when re-seeded without a remount', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ExampleObjectPicker {...baseProps} />);

    // Source is pre-seeded; pick the target row (the second matching button).
    const rowButtons = screen.getAllByRole('button', { name: /obj-a/i });
    expect(rowButtons).toHaveLength(2);
    await user.click(rowButtons[1]);

    // Both objects loaded → both preview cards render.
    expect(await screen.findByText('Target fields')).toBeInTheDocument();
    expect(screen.getByText('Source fields')).toBeInTheDocument();

    // Re-seed the picker for a different example (same instance, no remount).
    rerender(
      <ExampleObjectPicker {...baseProps} initialSourceObjectId="obj-b" />,
    );

    // The target side must reset too — otherwise the stale target object would
    // keep the "Target fields" card on screen.
    await waitFor(() => {
      expect(screen.queryByText('Target fields')).not.toBeInTheDocument();
    });
  });

  it('associates the object search label with its input', () => {
    render(<ExampleObjectPicker {...baseProps} />);

    const sourceSearch = screen.getByLabelText('Source object');
    const targetSearch = screen.getByLabelText('Target object');
    expect(sourceSearch.tagName).toBe('INPUT');
    expect(targetSearch.tagName).toBe('INPUT');
  });
});
