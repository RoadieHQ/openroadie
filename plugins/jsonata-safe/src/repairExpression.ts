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

import { JSONATA_SAFE_BUILTINS } from './builtins';

function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const BARE_FUNCTION_RE = new RegExp(
  `\\b(${JSONATA_SAFE_BUILTINS.map(escapeRegexLiteral).join('|')})\\s*\\(`,
  'g',
);

function isInsideString(expression: string, offset: number): boolean {
  let inSingle = false;
  let inDouble = false;
  let prevBackslashes = 0;
  for (let i = 0; i < offset; i++) {
    const char = expression[i];
    const isEscaped = prevBackslashes % 2 === 1;
    if (char === '"' && !inSingle && !isEscaped) {
      inDouble = !inDouble;
    } else if (char === "'" && !inDouble && !isEscaped) {
      inSingle = !inSingle;
    }
    prevBackslashes = char === '\\' ? prevBackslashes + 1 : 0;
  }
  return inSingle || inDouble;
}

export function repairBareFunctionCalls(expression: string): string {
  BARE_FUNCTION_RE.lastIndex = 0;
  return expression.replace(BARE_FUNCTION_RE, (match, name, offset) => {
    if (offset > 0 && expression[offset - 1] === '$') {
      return match;
    }
    if (isInsideString(expression, offset)) {
      return match;
    }
    return `$${name}(`;
  });
}
