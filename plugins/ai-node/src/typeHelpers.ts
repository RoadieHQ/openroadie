/*
 * Copyright 2025 Larder Software Ltd.
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
import { AGENTIC_MODELS } from './models';

function createModelTypeGuard<T extends string>(validValues: readonly T[]) {
  return (value: unknown): value is T => {
    return typeof value === 'string' && validValues.includes(value as T);
  };
}

export const isAgenticModelRef = createModelTypeGuard(AGENTIC_MODELS);
export const isConversationalModelRef = createModelTypeGuard(AGENTIC_MODELS);

export const getValidAgenticModels = () => [...AGENTIC_MODELS];
export const getValidConversationalModels = () => [...AGENTIC_MODELS];
export const getValidModels = () => [...AGENTIC_MODELS];
