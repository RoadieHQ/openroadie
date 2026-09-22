/*
 * Copyright 2026 Larder Software Ltd.
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
import { renderLiquidSafe } from '@roadiehq/liquid-safe';
import { DEFAULT_VIEW_TEMPLATE } from './contextGroupViews';

describe('DEFAULT_VIEW_TEMPLATE', () => {
  it('renders valid JSON with consistent indentation throughout', async () => {
    const member = {
      objectId: 'o-1',
      data: { name: 'Brian', nested: { a: 1 } },
    };
    const related = async () => ({
      owns: { items: [{ objectId: 'pr-1' }] },
    });

    const rendered = await renderLiquidSafe(
      DEFAULT_VIEW_TEMPLATE,
      { members: { github: [member] } },
      { data: { related } },
    );

    expect(JSON.parse(rendered)).toEqual({
      github: [
        {
          objectId: 'o-1',
          data: member.data,
          related: { owns: { items: [{ objectId: 'pr-1' }] } },
        },
      ],
    });

    // The formatting is the point: nested values sit at the column of the key
    // that introduces them, not flush-left.
    expect(rendered).toBe(
      [
        '{',
        '  "github": [',
        '    {',
        '      "objectId": "o-1",',
        '      "data": {',
        '        "name": "Brian",',
        '        "nested": {',
        '          "a": 1',
        '        }',
        '      },',
        '      "related": {',
        '        "owns": {',
        '          "items": [',
        '            {',
        '              "objectId": "pr-1"',
        '            }',
        '          ]',
        '        }',
        '      }',
        '    }',
        '  ]',
        '}',
      ].join('\n'),
    );
  });
});
