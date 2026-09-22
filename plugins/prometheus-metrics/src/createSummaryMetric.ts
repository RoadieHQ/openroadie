/*
 * Copyright 2023 Larder Software Ltd.
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
import { register, Summary, SummaryConfiguration } from 'prom-client';

export const createSummaryMetric = (
  configuration: SummaryConfiguration<string>,
): Summary => {
  const metric = new Summary(configuration);
  register.registerMetric(metric);
  return metric;
};

export { Summary } from 'prom-client';
