/*
 * Copyright 2024 Larder Software Ltd.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export function httpStatusFromExpressError(err: unknown): number {
  const e = err as {
    name?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  const raw = e.status ?? e.statusCode;
  if (
    typeof raw === 'number' &&
    Number.isInteger(raw) &&
    raw >= 100 &&
    raw <= 599
  ) {
    return raw;
  }
  if (e.name === 'InputError') return 400;
  if (e.name === 'NotAllowedError') return 403;
  if (e.name === 'NotFoundError') return 404;
  if (e.name === 'ConflictError') return 409;
  return 500;
}
