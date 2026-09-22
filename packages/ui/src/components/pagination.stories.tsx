import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { PaginationFooter } from './pagination';

const PAGE_SIZE = 25;
const TOTAL = 137;
const PAGE_COUNT = Math.ceil(TOTAL / PAGE_SIZE);

/** Controlled pager — wire it to whatever owns the page state. */
function ControlledPagination() {
  const [pageIndex, setPageIndex] = useState(0);
  return (
    <PaginationFooter
      filteredRowCount={TOTAL}
      pageIndex={pageIndex}
      pageSize={PAGE_SIZE}
      pageCount={PAGE_COUNT}
      onPreviousPage={() => setPageIndex(i => Math.max(0, i - 1))}
      onNextPage={() => setPageIndex(i => Math.min(PAGE_COUNT - 1, i + 1))}
      canPreviousPage={pageIndex > 0}
      canNextPage={pageIndex < PAGE_COUNT - 1}
    />
  );
}

const meta = {
  title: 'Components/PaginationFooter',
  component: ControlledPagination,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ControlledPagination>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  render: () => (
    <PaginationFooter
      filteredRowCount={0}
      pageIndex={0}
      pageSize={PAGE_SIZE}
      pageCount={0}
      onPreviousPage={() => {}}
      onNextPage={() => {}}
      canPreviousPage={false}
      canNextPage={false}
    />
  ),
};
