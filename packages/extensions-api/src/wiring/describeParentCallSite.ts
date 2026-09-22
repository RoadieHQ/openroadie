/*
 * Copyright 2023 The Backstage Authors
 * Modifications copyright 2025 Larder Software Limited
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
 *
 * Derived from Backstage (https://github.com/backstage/backstage),
 * packages/frontend-plugin-api/src/routing/describeParentCallSite.ts at v1.47.1, and modified.
 */

const MESSAGE_MARKER = 'eHgtF5hmbrXyiEvo';

export function describeParentCallSite(
  ErrorConstructor: ErrorConstructor = Error,
): string {
  const { stack } = new ErrorConstructor(MESSAGE_MARKER);
  if (!stack) {
    return '<unknown>';
  }
  const startIndex = stack.includes(MESSAGE_MARKER)
    ? stack.indexOf('\n') + 1
    : 0;
  const secondEntryStart =
    stack.indexOf('\n', stack.indexOf('\n', startIndex) + 1) + 1;
  const secondEntryEnd = stack.indexOf('\n', secondEntryStart);
  const line = stack.substring(secondEntryStart, secondEntryEnd).trim();
  if (!line) {
    return 'unknown';
  }
  if (line.includes('(')) {
    return line.substring(line.indexOf('(') + 1, line.indexOf(')'));
  }
  if (line.includes('@')) {
    return line.substring(line.indexOf('@') + 1);
  }
  return line;
}
