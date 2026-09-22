/*
 * Copyright 2022 The Backstage Authors
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
 * packages/types/src/time.ts at v1.47.1, and modified.
 */

/**
 * JSON primitive types.
 */
export type JsonPrimitive = string | number | boolean | null;

/**
 * JSON array type.
 */
export type JsonArray = JsonValue[];

/**
 * JSON object type.
 */
export type JsonObject = { [key: string]: JsonValue };

/**
 * Any JSON-serializable value.
 */
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/**
 * A human-friendly duration object with optional time unit fields.
 */
export type HumanDuration = {
  years?: number;
  months?: number;
  weeks?: number;
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  milliseconds?: number;
};

/**
 * Converts a HumanDuration to milliseconds.
 */
export function durationToMilliseconds(duration: HumanDuration): number {
  const {
    years = 0,
    months = 0,
    weeks = 0,
    days = 0,
    hours = 0,
    minutes = 0,
    seconds = 0,
    milliseconds = 0,
  } = duration;

  return (
    milliseconds +
    seconds * 1000 +
    minutes * 60 * 1000 +
    hours * 60 * 60 * 1000 +
    days * 24 * 60 * 60 * 1000 +
    weeks * 7 * 24 * 60 * 60 * 1000 +
    months * 30 * 24 * 60 * 60 * 1000 +
    years * 365 * 24 * 60 * 60 * 1000
  );
}
