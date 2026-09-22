/*
 * Copyright 2026 Larder Software Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExecutionFailureNotice } from './execution-failure-notice';

const DUPLICATE_IDS_ERROR =
  'PublishAbortedError: Duplicate objectId values: 348b8666, 482723ca. Prefer a compound unique index (JSONata).';

describe('ExecutionFailureNotice', () => {
  it('explains a publish failure that no node can be blamed for', () => {
    render(
      <ExecutionFailureNotice
        error={DUPLICATE_IDS_ERROR}
        hasNodeError={false}
      />,
    );

    expect(
      screen.getByText('Duplicate object IDs — the ID selector is not unique'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/change the sink's collision handling/),
    ).toBeInTheDocument();
  });

  it('keeps the raw error available to copy', () => {
    render(
      <ExecutionFailureNotice
        error={DUPLICATE_IDS_ERROR}
        hasNodeError={false}
      />,
    );

    expect(
      screen.getByRole('button', { name: /copy error/i }),
    ).toBeInTheDocument();
  });

  it('renders nothing when a node already shows the underlying error', () => {
    const { container } = render(
      <ExecutionFailureNotice
        error="1 node(s) failed during execution"
        hasNodeError
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('still shows a run-level error alongside a failed node', () => {
    render(<ExecutionFailureNotice error={DUPLICATE_IDS_ERROR} hasNodeError />);

    expect(
      screen.getByText('Duplicate object IDs — the ID selector is not unique'),
    ).toBeInTheDocument();
  });

  it('says where to look when the engine reported no error at all', () => {
    render(<ExecutionFailureNotice hasNodeError={false} />);

    expect(screen.getByText(/Check the Logs tab/)).toBeInTheDocument();
  });
});
