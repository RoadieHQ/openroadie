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
 * Human friendly durations object.
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
 *
 * Note: This conversion is an approximation assuming 365-day years,
 * 30-day months, and fixed 24-hour days.
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

  const totalDays = years * 365 + months * 30 + weeks * 7 + days;
  const totalHours = totalDays * 24 + hours;
  const totalMinutes = totalHours * 60 + minutes;
  const totalSeconds = totalMinutes * 60 + seconds;
  const totalMilliseconds = totalSeconds * 1000 + milliseconds;

  return totalMilliseconds;
}
