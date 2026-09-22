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

export enum MODEL_TIER {
  LARGE = 'large',
  MEDIUM = 'medium',
  SMALL = 'small',
}

export const AGENTIC_MODELS = Object.values(MODEL_TIER);

export type AgenticModelRef = MODEL_TIER;
export type InferenceModelRef = MODEL_TIER;
export type ModelRef = MODEL_TIER;
