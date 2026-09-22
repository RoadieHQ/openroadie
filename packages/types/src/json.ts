/*
 * Copyright 2021 The Backstage Authors
 * Modifications copyright 2024 Larder Software Limited
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
 * packages/types/src/json.ts at v1.47.1, and modified.
 */

/**
 * A type representing all allowed JSON primitive values.
 */
export type JsonPrimitive = number | string | boolean | null;

/**
 * A type representing all allowed JSON object values.
 */
export type JsonObject = { [key in string]?: JsonValue };

/**
 * A type representing all allowed JSON array values.
 */
export interface JsonArray extends Array<JsonValue> {}

/**
 * A type representing all allowed JSON values.
 */
export type JsonValue = JsonObject | JsonArray | JsonPrimitive;
