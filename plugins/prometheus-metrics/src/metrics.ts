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
import {
  Histogram,
  Gauge,
  HistogramConfiguration,
  GaugeConfiguration,
  CounterConfiguration,
  Counter,
  register,
} from 'prom-client';

const timers: Record<string, (labels?: Record<string, string>) => number> = {};

function createHistogramMetric<T extends string>(
  config: HistogramConfiguration<T>,
): Histogram<T> {
  const existing = register.getSingleMetric(config.name) as Histogram<T>;
  return existing || new Histogram<T>(config);
}

function createGaugeMetric<T extends string>(
  config: GaugeConfiguration<T>,
): Gauge<T> {
  const existing = register.getSingleMetric(config.name) as Gauge<T>;
  return existing || new Gauge<T>(config);
}

export const setPrometheusGaugeMetric = (
  name: string,
  help: string,
  labels: string[],
  options: Record<string, string | number>,
  value: number,
) => {
  const metric = createGaugeMetric({
    name: name,
    help: help,
    labelNames: labels,
  });
  metric.set(options, value);
};

export const startPrometheusHistogramMetric = (
  name: string,
  help: string,
  labels: string[],
) => {
  const metric = createHistogramMetric({
    name: name,
    help: help,
    labelNames: labels,
    buckets: [0.1, 0.3, 0.5, 1, 3, 5, 7, 10],
  });

  timers[name] = metric.startTimer();
};

export const stopPrometheusHistogramMetric = (name: string, result: string) => {
  const timer = timers[name];

  if (timer) {
    timer({ result });
    delete timers[name];
  }
};

function createCounterMetric<T extends string>(
  config: CounterConfiguration<T>,
): Counter<T> {
  const existing = register.getSingleMetric(config.name) as Counter<T>;
  return existing || new Counter<T>(config);
}

export const incrementPrometheusCounterMetric = (
  name: string,
  help: string,
  labels: string[],
  labelValues: Record<string, string>,
  incrementBy = 1,
) => {
  const metric = createCounterMetric({
    name,
    help,
    labelNames: labels,
  });
  metric.inc(labelValues, incrementBy);
};
