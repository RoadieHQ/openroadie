import { act, renderHook } from '@testing-library/react';
import type { KeyboardEvent } from 'react';
import { useEditableName } from './use-editable-name';

const key = (k: string) =>
  ({ key: k, preventDefault: () => {} }) as unknown as KeyboardEvent;

describe('useEditableName', () => {
  it('commits the edited name on Enter and exits editing', () => {
    const onNameChange = vi.fn();
    const { result } = renderHook(() =>
      useEditableName({ name: 'Original', onNameChange }),
    );

    act(() => result.current.startEditing());
    act(() => result.current.handleChange('New Name'));
    act(() => result.current.handleKeyDown(key('Enter')));

    expect(onNameChange).toHaveBeenCalledWith('New Name');
    expect(result.current.isEditing).toBe(false);
  });

  it('reverts to the original name on Escape without saving', () => {
    const onNameChange = vi.fn();
    const { result } = renderHook(() =>
      useEditableName({ name: 'Original', onNameChange }),
    );

    act(() => result.current.startEditing());
    act(() => result.current.handleChange('Discarded'));
    expect(result.current.localName).toBe('Discarded');

    act(() => result.current.handleKeyDown(key('Escape')));

    expect(result.current.isEditing).toBe(false);
    expect(result.current.localName).toBe('Original');
    expect(onNameChange).not.toHaveBeenCalled();
  });

  it('commits synchronously on blur so a Save click sees the new value', () => {
    const onNameChange = vi.fn();
    const { result } = renderHook(() =>
      useEditableName({ name: 'Original', onNameChange }),
    );

    act(() => result.current.startEditing());
    act(() => result.current.handleChange('Blurred'));
    act(() => result.current.handleBlur());

    expect(onNameChange).toHaveBeenCalledWith('Blurred');
    expect(result.current.isEditing).toBe(false);
  });

  it('does not double-commit on the blur that follows Enter', () => {
    const onNameChange = vi.fn();
    const { result } = renderHook(() =>
      useEditableName({ name: 'Original', onNameChange }),
    );

    act(() => result.current.startEditing());
    act(() => result.current.handleChange('Committed'));
    act(() => result.current.handleKeyDown(key('Enter')));
    act(() => result.current.handleBlur());

    expect(onNameChange).toHaveBeenCalledTimes(1);
    expect(onNameChange).toHaveBeenCalledWith('Committed');
  });

  it('does not commit on the blur that follows Escape', () => {
    const onNameChange = vi.fn();
    const { result } = renderHook(() =>
      useEditableName({ name: 'Original', onNameChange }),
    );

    act(() => result.current.startEditing());
    act(() => result.current.handleChange('Discarded'));
    act(() => result.current.handleKeyDown(key('Escape')));
    act(() => result.current.handleBlur());

    expect(onNameChange).not.toHaveBeenCalled();
  });

  it('resets the local name when the external name prop changes', () => {
    const onNameChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ name }) => useEditableName({ name, onNameChange }),
      { initialProps: { name: 'First' } },
    );
    expect(result.current.localName).toBe('First');

    rerender({ name: 'Second' });
    expect(result.current.localName).toBe('Second');
  });
});
