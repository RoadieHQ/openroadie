import React from 'react';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@roadiehq/ui/outlined-select', async () => {
  const { Button } = await import('@roadiehq/ui/button');

  return {
    OutlinedSelect: ({
      label,
      value,
      onValueChange,
      children,
    }: {
      label: string;
      value?: string;
      onValueChange: (value: string) => void;
      children: React.ReactNode;
    }) => {
      const collectItems = (
        nodes: React.ReactNode,
      ): Array<{ value: string; label: React.ReactNode }> => {
        const items: Array<{ value: string; label: React.ReactNode }> = [];

        for (const child of React.Children.toArray(nodes)) {
          if (!React.isValidElement(child)) {
            continue;
          }

          if (typeof child.props.value === 'string') {
            items.push({
              value: child.props.value,
              label: child.props.children,
            });
          }

          if (child.props.children) {
            items.push(...collectItems(child.props.children));
          }
        }

        return items;
      };

      return (
        <div role="group" aria-label={label}>
          <span>{label}</span>
          <div>
            {collectItems(children).map(item => (
              <Button
                key={item.value}
                type="button"
                aria-pressed={value === item.value}
                onClick={() => onValueChange(item.value)}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>
      );
    },
  };
});

vi.mock('@roadiehq/ui/select', () => ({
  SelectItem: ({ children: _children }: { children: React.ReactNode }) => null,
}));

import { PaginationSettings } from './pagination-settings';

afterEach(() => {
  cleanup();
});

describe('PaginationSettings', () => {
  it('shows next link condition controls for link pagination', () => {
    render(
      <PaginationSettings
        pagination={{
          type: 'link',
          perPageParam: 'per_page',
          perPage: 100,
          nextLinkCondition: {
            param: 'results',
            equals: 'true',
          },
        }}
        onChange={vi.fn()}
        mode="rest"
        title={null}
      />,
    );

    expect(screen.getByLabelText('Next Link Condition Parameter')).toBeTruthy();
    expect(screen.getByText('Next Link Condition Operator')).toBeTruthy();
    expect(screen.getByLabelText('Next Link Condition Value')).toBeTruthy();
  });

  it('lets users override the follow-up request method for link pagination', () => {
    const onChange = vi.fn();
    render(
      <PaginationSettings
        pagination={{
          type: 'link',
          perPageParam: 'per_page',
          perPage: 100,
        }}
        onChange={onChange}
        mode="rest"
        title={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'GET' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'link',
        nextRequestMethod: 'GET',
      }),
    );
  });

  it('does not emit nextLinkCondition with only param before an operator is chosen', () => {
    const onChange = vi.fn();
    render(
      <PaginationSettings
        pagination={{
          type: 'link',
          perPageParam: 'per_page',
          perPage: 100,
        }}
        onChange={onChange}
        mode="rest"
        title={null}
      />,
    );

    fireEvent.change(screen.getByLabelText('Next Link Condition Parameter'), {
      target: { value: 'results' },
    });

    for (const [payload] of onChange.mock.calls) {
      if (
        payload &&
        typeof payload === 'object' &&
        payload.type === 'link' &&
        payload.nextLinkCondition
      ) {
        const c = payload.nextLinkCondition;
        expect(c.equals !== undefined || c.notEquals !== undefined).toBe(true);
      }
    }
  });

  it('keeps a comparator key when the condition value is cleared', () => {
    const onChange = vi.fn();
    render(
      <PaginationSettings
        pagination={{
          type: 'link',
          perPageParam: 'per_page',
          perPage: 100,
          nextLinkCondition: { param: 'rel', equals: 'next' },
        }}
        onChange={onChange}
        mode="rest"
        title={null}
      />,
    );

    fireEvent.change(screen.getByLabelText('Next Link Condition Value'), {
      target: { value: '' },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'link',
        nextLinkCondition: { param: 'rel', equals: '' },
      }),
    );
  });

  it('lets users place offset pagination parameters in the request body', () => {
    const onChange = vi.fn();
    render(
      <PaginationSettings
        pagination={{
          type: 'offset',
          offsetParam: '$skip',
          limitParam: '$top',
          limit: 1000,
        }}
        onChange={onChange}
        mode="rest"
        title={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Request Body' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'offset',
        paramLocation: 'body',
      }),
    );
  });

  it('lets users place cursor pagination parameters in the request body', () => {
    const onChange = vi.fn();
    render(
      <PaginationSettings
        pagination={{
          type: 'cursor',
          cursorParam: '$skipToken',
          nextCursorExpression: 'skipToken',
        }}
        onChange={onChange}
        mode="rest"
        title={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Request Body' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'cursor',
        paramLocation: 'body',
      }),
    );
  });

  it('lets users nest body cursor parameters under a body params path', () => {
    const onChange = vi.fn();
    render(
      <PaginationSettings
        pagination={{
          type: 'cursor',
          cursorParam: '$skipToken',
          nextCursorExpression: 'skipToken',
          paramLocation: 'body',
        }}
        onChange={onChange}
        mode="rest"
        title={null}
      />,
    );

    fireEvent.change(screen.getByLabelText('Body Params Path'), {
      target: { value: 'options' },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'cursor',
        paramLocation: 'body',
        bodyParamsPath: 'options',
      }),
    );
  });

  it('clears the cursor body params path when switching back to query parameters', () => {
    const onChange = vi.fn();
    render(
      <PaginationSettings
        pagination={{
          type: 'cursor',
          cursorParam: '$skipToken',
          nextCursorExpression: 'skipToken',
          paramLocation: 'body',
          bodyParamsPath: 'options',
        }}
        onChange={onChange}
        mode="rest"
        title={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Query Parameters' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'cursor',
        paramLocation: 'query',
        bodyParamsPath: undefined,
      }),
    );
  });

  it('lets users nest body offset parameters under a body params path', () => {
    const onChange = vi.fn();
    render(
      <PaginationSettings
        pagination={{
          type: 'offset',
          offsetParam: '$skip',
          limitParam: '$top',
          limit: 1000,
          paramLocation: 'body',
        }}
        onChange={onChange}
        mode="rest"
        title={null}
      />,
    );

    fireEvent.change(screen.getByLabelText('Body Params Path'), {
      target: { value: 'options' },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'offset',
        paramLocation: 'body',
        bodyParamsPath: 'options',
      }),
    );
  });

  it('hides the body params path unless parameters are placed in the body', () => {
    render(
      <PaginationSettings
        pagination={{
          type: 'offset',
          offsetParam: '$skip',
          limitParam: '$top',
          limit: 1000,
          paramLocation: 'query',
        }}
        onChange={vi.fn()}
        mode="rest"
        title={null}
      />,
    );

    expect(screen.queryByLabelText('Body Params Path')).toBeNull();
  });

  it('clears the body params path when switching back to query parameters', () => {
    const onChange = vi.fn();
    render(
      <PaginationSettings
        pagination={{
          type: 'offset',
          offsetParam: '$skip',
          limitParam: '$top',
          limit: 1000,
          paramLocation: 'body',
          bodyParamsPath: 'options',
        }}
        onChange={onChange}
        mode="rest"
        title={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Query Parameters' }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'offset',
        paramLocation: 'query',
        bodyParamsPath: undefined,
      }),
    );
  });

  it('lets users configure an offset pagination total expression', () => {
    const onChange = vi.fn();
    render(
      <PaginationSettings
        pagination={{
          type: 'offset',
          offsetParam: '$skip',
          limitParam: '$top',
          limit: 1000,
          paramLocation: 'body',
        }}
        onChange={onChange}
        mode="rest"
        title={null}
      />,
    );

    fireEvent.change(screen.getByLabelText('Total Expression'), {
      target: { value: 'count' },
    });

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'offset',
        totalExpression: 'count',
      }),
    );
  });

  it('disables "Save as Integration Default" while the cursor variable is undeclared', () => {
    render(
      <PaginationSettings
        pagination={{
          type: 'graphql-cursor',
          cursorVariable: 'after',
          nextCursorExpression: '',
        }}
        onChange={vi.fn()}
        mode="rest"
        paginationMode="custom"
        onPaginationModeChange={vi.fn()}
        onApplyToIntegration={vi.fn()}
        graphqlQuery="query Foo { viewer { login } }"
        title={null}
      />,
    );

    expect(screen.getByText(/is not declared in the query/i)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Save as Integration Default' }),
    ).toHaveProperty('disabled', true);
  });

  it('enables "Save as Integration Default" once the cursor variable is declared', () => {
    render(
      <PaginationSettings
        pagination={{
          type: 'graphql-cursor',
          cursorVariable: 'after',
          nextCursorExpression: '',
        }}
        onChange={vi.fn()}
        mode="rest"
        paginationMode="custom"
        onPaginationModeChange={vi.fn()}
        onApplyToIntegration={vi.fn()}
        graphqlQuery="query Foo($after: String) { viewer { login } }"
        title={null}
      />,
    );

    expect(screen.queryByText(/is not declared in the query/i)).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Save as Integration Default' }),
    ).toHaveProperty('disabled', false);
  });

  it('resets the config when switching pagination types', () => {
    const onChange = vi.fn();
    render(
      <PaginationSettings
        pagination={{
          type: 'cursor',
          cursorParam: 'cursor',
          nextCursorExpression: 'response.next',
        }}
        onChange={onChange}
        mode="rest"
        title={null}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Page Number' }));

    expect(onChange).toHaveBeenCalledWith({
      type: 'page',
      pageParam: 'page',
      perPageParam: 'per_page',
      perPage: 100,
      startPage: 1,
    });
  });
});
