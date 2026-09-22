import { renderHook as rtlRenderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TestQueryProvider } from '../../test-utils';
import { useChainedSourceSchemas } from './use-chained-source-schemas';
import type { WorkflowClient } from '../../api';
import type { PipelineStep } from './types';

const makeApi = () =>
  ({
    integrationSchemas: {
      // Never resolves: keeps the query pending so the hook stays on its
      // fallback value for the duration of the test.
      getSchema: vi.fn(() => new Promise(() => {})),
    },
  }) as unknown as WorkflowClient;

const chainedTransform = (config: Record<string, unknown>): PipelineStep => ({
  id: 'chained-1',
  type: 'chained-source',
  config,
});

describe('useChainedSourceSchemas', () => {
  it('returns an identity-stable result across re-renders while the query is pending', () => {
    // A fresh `{}` per render would ripple through the finalSchema memo and
    // the setAccumulatedSchema effect in TransformSteps into an infinite
    // render loop ("Maximum update depth exceeded") once node outputs exist.
    const api = makeApi();
    const transforms = [
      chainedTransform({
        integrationId: 'int-1',
        backendType: 'http',
        path: '/orgs',
        method: 'GET',
      }),
    ];

    const { result, rerender } = rtlRenderHook(
      () => useChainedSourceSchemas(api, transforms),
      { wrapper: TestQueryProvider },
    );

    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  it('keeps the same identity when the transforms array identity changes but its content does not', () => {
    const api = makeApi();
    const makeTransforms = () => [
      chainedTransform({
        integrationId: 'int-1',
        backendType: 'http',
        path: '/orgs',
        method: 'GET',
      }),
    ];

    const { result, rerender } = rtlRenderHook(
      ({ transforms }) => useChainedSourceSchemas(api, transforms),
      {
        wrapper: TestQueryProvider,
        initialProps: { transforms: makeTransforms() },
      },
    );

    const first = result.current;
    rerender({ transforms: makeTransforms() });
    expect(result.current).toBe(first);
  });
});
