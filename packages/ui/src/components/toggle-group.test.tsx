import { useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToggleGroup, type ToggleGroupProps } from './toggle-group';

type Mode = 'list' | 'table' | 'graph';

const ITEMS: ToggleGroupProps<Mode>['items'] = [
  { value: 'list', label: 'List' },
  { value: 'table', label: 'Table' },
  { value: 'graph', label: 'Graph' },
];

function Harness({
  initial = 'list',
  onValueChange,
  ...rest
}: {
  initial?: Mode;
  onValueChange?: (value: Mode) => void;
} & Partial<
  Omit<ToggleGroupProps<Mode>, 'value' | 'onValueChange' | 'items'>
>) {
  const [value, setValue] = useState<Mode>(initial);
  return (
    <ToggleGroup<Mode>
      value={value}
      onValueChange={next => {
        setValue(next);
        onValueChange?.(next);
      }}
      items={ITEMS}
      aria-label="View mode"
      {...rest}
    />
  );
}

const radios = () => screen.getAllByRole('radio');

describe('ToggleGroup', () => {
  it('should render one radio per item inside a radiogroup', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup')).toBeInTheDocument();
    expect(radios()).toHaveLength(3);
    expect(radios()[0]).toHaveAttribute('aria-checked', 'true');
  });

  describe('roving tabindex', () => {
    it('should make only the selected item tabbable', () => {
      render(<Harness initial="table" />);
      expect(radios().map(r => r.getAttribute('tabindex'))).toEqual([
        '-1',
        '0',
        '-1',
      ]);
    });

    it('should fall back to the first item when nothing is selected', () => {
      render(
        <ToggleGroup<Mode>
          // @ts-expect-error - deliberately a value outside the item list
          value="none"
          onValueChange={() => {}}
          items={ITEMS}
        />,
      );
      expect(radios().map(r => r.getAttribute('tabindex'))).toEqual([
        '0',
        '-1',
        '-1',
      ]);
    });

    it('should be a single tab stop', async () => {
      const user = userEvent.setup();
      render(
        <>
          <Harness />
          <button type="button">after</button>
        </>,
      );
      await user.tab();
      expect(radios()[0]).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: 'after' })).toHaveFocus();
    });

    it('should follow the selection after an arrow key', async () => {
      const user = userEvent.setup();
      render(<Harness />);
      radios()[0].focus();
      await user.keyboard('{ArrowRight}');
      expect(radios().map(r => r.getAttribute('tabindex'))).toEqual([
        '-1',
        '0',
        '-1',
      ]);
    });

    it('should sync focus when controlled value changes while focused', async () => {
      const user = userEvent.setup();
      let setValueExternal!: (value: Mode) => void;
      function Controlled() {
        const [value, setValue] = useState<Mode>('list');
        setValueExternal = setValue;
        return (
          <ToggleGroup<Mode>
            value={value}
            onValueChange={setValue}
            items={ITEMS}
          />
        );
      }
      render(<Controlled />);
      radios()[0].focus();
      act(() => setValueExternal('graph'));
      expect(radios()[2]).toHaveFocus();
      expect(radios()[2]).toHaveAttribute('aria-checked', 'true');
      await user.keyboard('{ArrowRight}');
      expect(radios()[0]).toHaveFocus();
      expect(radios()[0]).toHaveAttribute('aria-checked', 'true');
    });

    it('should not steal focus when value changes while focus is outside', () => {
      let setValueExternal!: (value: Mode) => void;
      function Controlled() {
        const [value, setValue] = useState<Mode>('list');
        setValueExternal = setValue;
        return (
          <>
            <ToggleGroup<Mode>
              value={value}
              onValueChange={setValue}
              items={ITEMS}
            />
            <button type="button">outside</button>
          </>
        );
      }
      render(<Controlled />);
      screen.getByRole('button', { name: 'outside' }).focus();
      act(() => setValueExternal('graph'));
      expect(screen.getByRole('button', { name: 'outside' })).toHaveFocus();
      expect(radios()[2]).toHaveAttribute('aria-checked', 'true');
    });
  });

  describe('horizontal arrow keys', () => {
    it('should move selection and focus with ArrowRight', async () => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      render(<Harness onValueChange={onValueChange} />);
      radios()[0].focus();
      await user.keyboard('{ArrowRight}');
      expect(onValueChange).toHaveBeenCalledWith('table');
      expect(radios()[1]).toHaveFocus();
      expect(radios()[1]).toHaveAttribute('aria-checked', 'true');
    });

    it('should wrap from last to first with ArrowRight', async () => {
      const user = userEvent.setup();
      render(<Harness initial="graph" />);
      radios()[2].focus();
      await user.keyboard('{ArrowRight}');
      expect(radios()[0]).toHaveFocus();
      expect(radios()[0]).toHaveAttribute('aria-checked', 'true');
    });

    it('should wrap from first to last with ArrowLeft', async () => {
      const user = userEvent.setup();
      render(<Harness />);
      radios()[0].focus();
      await user.keyboard('{ArrowLeft}');
      expect(radios()[2]).toHaveFocus();
      expect(radios()[2]).toHaveAttribute('aria-checked', 'true');
    });

    it('should ignore ArrowDown/ArrowUp when horizontal', async () => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      render(<Harness onValueChange={onValueChange} />);
      radios()[0].focus();
      await user.keyboard('{ArrowDown}{ArrowUp}');
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  describe('vertical arrow keys', () => {
    it('should set aria-orientation only when vertical', () => {
      const { unmount } = render(<Harness orientation="vertical" />);
      expect(screen.getByRole('radiogroup')).toHaveAttribute(
        'aria-orientation',
        'vertical',
      );
      unmount();
      render(<Harness />);
      expect(screen.getByRole('radiogroup')).not.toHaveAttribute(
        'aria-orientation',
      );
    });

    it('should wrap from last to first with ArrowDown', async () => {
      const user = userEvent.setup();
      render(<Harness initial="graph" orientation="vertical" />);
      radios()[2].focus();
      await user.keyboard('{ArrowDown}');
      expect(radios()[0]).toHaveFocus();
      expect(radios()[0]).toHaveAttribute('aria-checked', 'true');
    });

    it('should wrap from first to last with ArrowUp', async () => {
      const user = userEvent.setup();
      render(<Harness orientation="vertical" />);
      radios()[0].focus();
      await user.keyboard('{ArrowUp}');
      expect(radios()[2]).toHaveFocus();
      expect(radios()[2]).toHaveAttribute('aria-checked', 'true');
    });

    it('should ignore ArrowRight/ArrowLeft when vertical', async () => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      render(<Harness orientation="vertical" onValueChange={onValueChange} />);
      radios()[0].focus();
      await user.keyboard('{ArrowRight}{ArrowLeft}');
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  describe('Home / End', () => {
    it('should select the first item with Home', async () => {
      const user = userEvent.setup();
      render(<Harness initial="graph" />);
      radios()[2].focus();
      await user.keyboard('{Home}');
      expect(radios()[0]).toHaveFocus();
      expect(radios()[0]).toHaveAttribute('aria-checked', 'true');
    });

    it('should select the last item with End', async () => {
      const user = userEvent.setup();
      render(<Harness />);
      radios()[0].focus();
      await user.keyboard('{End}');
      expect(radios()[2]).toHaveFocus();
      expect(radios()[2]).toHaveAttribute('aria-checked', 'true');
    });

    it('should work vertically too', async () => {
      const user = userEvent.setup();
      render(<Harness orientation="vertical" />);
      radios()[0].focus();
      await user.keyboard('{End}');
      expect(radios()[2]).toHaveFocus();
      await user.keyboard('{Home}');
      expect(radios()[0]).toHaveFocus();
    });

    // Consumers may read a repeat of the current value as a deliberate
    // re-select (the relationships editor toggles back to its default mode on
    // one), so landing on the already-selected item must not report a change.
    it('should not fire onValueChange when End lands on the selected item', async () => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      render(<Harness onValueChange={onValueChange} />);
      radios()[0].focus();
      await user.keyboard('{End}');
      expect(onValueChange).toHaveBeenCalledTimes(1);
      onValueChange.mockClear();

      await user.keyboard('{End}');
      expect(radios()[2]).toHaveFocus();
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('should not fire onValueChange when Home lands on the selected item', async () => {
      const user = userEvent.setup();
      const onValueChange = vi.fn();
      render(<Harness onValueChange={onValueChange} />);
      radios()[0].focus();
      await user.keyboard('{Home}');
      expect(radios()[0]).toHaveFocus();
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  it('should fire onValueChange when the active item is clicked again', async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <ToggleGroup<Mode>
        value="table"
        onValueChange={onValueChange}
        items={ITEMS}
      />,
    );
    await user.click(radios()[1]);
    expect(onValueChange).toHaveBeenCalledWith('table');
  });
});
