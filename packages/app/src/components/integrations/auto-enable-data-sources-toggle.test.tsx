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

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AutoEnableDataSourcesToggle } from './auto-enable-data-sources-toggle';

describe('AutoEnableDataSourcesToggle', () => {
  it('lists matching data sources when the expander is opened', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();

    render(
      <AutoEnableDataSourcesToggle
        checked
        onCheckedChange={onCheckedChange}
        seedNames={[
          'CircleCI pipelines (all organizations)',
          'CircleCI workflows (all organizations)',
          'CircleCI jobs (all organizations)',
        ]}
      />,
    );

    expect(
      screen.queryByText('CircleCI pipelines (all organizations)'),
    ).toBeNull();

    await user.click(
      screen.getByRole('button', { name: 'Show 3 data sources' }),
    );

    expect(
      screen.getByText('CircleCI pipelines (all organizations)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('CircleCI workflows (all organizations)'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('CircleCI jobs (all organizations)'),
    ).toBeInTheDocument();
  });

  it('forwards toggle changes', async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();

    render(
      <AutoEnableDataSourcesToggle
        checked
        onCheckedChange={onCheckedChange}
        seedNames={['PagerDuty incidents']}
      />,
    );

    await user.click(
      screen.getByRole('switch', {
        name: 'Automatically enable data sources',
      }),
    );

    expect(onCheckedChange).toHaveBeenCalledWith(false);
  });
});
