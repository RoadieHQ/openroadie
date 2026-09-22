/*
 * Copyright 2021 The Backstage Authors
 * Modifications copyright 2026 Larder Software Limited
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
 * packages/backend-defaults/src/entrypoints/scheduler/lib/PluginTaskSchedulerImpl.ts at v1.47.1, and modified.
 */

import {
  LoggerService,
  RootLifecycleService,
  SchedulerServiceTaskDescriptor,
  SchedulerServiceTaskFunction,
  SchedulerServiceTaskInvocationDefinition,
  SchedulerServiceTaskRunner,
  SchedulerServiceTaskScheduleDefinition,
} from '@roadiehq/extensions-api';
import { Counter, Gauge, Histogram, metrics, trace } from '@opentelemetry/api';
import { Knex } from 'knex';
import { Duration } from 'luxon';
import { LocalTaskWorker } from './LocalTaskWorker';
import { TaskWorker } from './TaskWorker';
import { TaskApiTasksResponse, TaskSettingsV2 } from './types';
import { delegateAbortController, TRACER_ID, validateId } from './util';
import express from 'express';
import Router from 'express-promise-router';
import type { EventsService } from '../../events/types';
import { filterTasks } from './filterTasks';
import {
  EnhancedTaskInfo,
  RoadieSchedulerService,
  TaskInfoEnhancer,
} from '@roadiehq/backend-common';

const tracer = trace.getTracer(TRACER_ID);

/**
 * Implements the actual task management.
 */
export class PluginTaskSchedulerImpl implements RoadieSchedulerService {
  private readonly localWorkersById = new Map<string, LocalTaskWorker>();
  private readonly globalWorkersById = new Map<string, TaskWorker>();
  private readonly allScheduledTasks: SchedulerServiceTaskDescriptor[] = [];
  private readonly shutdownInitiated: Promise<boolean>;
  private runLocalJobsOnly: boolean;

  private readonly counter: Counter;
  private readonly duration: Histogram;
  private readonly lastStarted: Gauge;
  private readonly lastCompleted: Gauge;

  constructor(
    private readonly pluginId: string,
    private readonly databaseFactory: () => Promise<Knex>,
    private readonly logger: LoggerService,
    rootLifecycle?: RootLifecycleService,
    runLocalJobsOnly?: boolean,
    private taskInfoEnhancer?: TaskInfoEnhancer,
  ) {
    this.runLocalJobsOnly = runLocalJobsOnly || false;
    const meter = metrics.getMeter('default');
    this.counter = meter.createCounter('backend_tasks.task.runs.count', {
      description: 'Total number of times a task has been run',
    });
    this.duration = meter.createHistogram('backend_tasks.task.runs.duration', {
      description: 'Histogram of task run durations',
      unit: 'seconds',
    });

    this.lastStarted = meter.createGauge('backend_tasks.task.runs.started', {
      description: 'Epoch timestamp seconds when the task was last started',
      unit: 'seconds',
    });
    this.lastCompleted = meter.createGauge(
      'backend_tasks.task.runs.completed',
      {
        description: 'Epoch timestamp seconds when the task was last completed',
        unit: 'seconds',
      },
    );
    this.shutdownInitiated = new Promise(shutdownInitiated => {
      rootLifecycle?.addShutdownHook(() => shutdownInitiated(true));
    });
    rootLifecycle?.addStartupHook(() => {
      this.runLocalJobsOnly = false;
    });
  }

  setTaskInfoEnhancer(enhancer: TaskInfoEnhancer) {
    this.taskInfoEnhancer = enhancer;
  }

  async triggerTask(id: string): Promise<void> {
    const localTask = this.localWorkersById.get(id);
    if (localTask) {
      localTask.trigger();
      return;
    }

    const knex = await this.databaseFactory();
    await TaskWorker.trigger(knex, id);
  }

  async scheduleTask(
    task: SchedulerServiceTaskScheduleDefinition &
      SchedulerServiceTaskInvocationDefinition,
  ): Promise<void> {
    validateId(task.id);
    const scope = task.scope ?? 'global';

    const settings: TaskSettingsV2 = {
      version: 2,
      cadence: parseDuration(task.frequency),
      initialDelayDuration:
        task.initialDelay && parseDuration(task.initialDelay),
      timeoutAfterDuration: parseDuration(task.timeout),
    };

    // Delegated abort controller that will abort either when the provided
    // controller aborts, or when a root lifecycle shutdown happens
    const abortController = delegateAbortController(task.signal);
    this.shutdownInitiated.then(() => abortController.abort());

    if (scope === 'global') {
      const knex = await this.databaseFactory();
      const worker = new TaskWorker(
        task.id,
        this.instrumentedFunction(task, scope),
        knex,
        this.logger.child({ task: task.id }),
        this.runLocalJobsOnly,
      );
      await worker.start(settings, { signal: abortController.signal });
      this.globalWorkersById.set(task.id, worker);
    } else {
      const worker = new LocalTaskWorker(
        task.id,
        this.instrumentedFunction(task, scope),
        this.logger.child({ task: task.id }),
      );
      worker.start(settings, { signal: abortController.signal });
      this.localWorkersById.set(task.id, worker);
    }

    this.allScheduledTasks.push({
      id: task.id,
      scope: scope,
      settings: settings,
    });
  }

  createScheduledTaskRunner(
    schedule: SchedulerServiceTaskScheduleDefinition,
  ): SchedulerServiceTaskRunner {
    return {
      run: async task => {
        await this.scheduleTask({ ...task, ...schedule });
      },
    };
  }

  async getScheduledTasks(): Promise<SchedulerServiceTaskDescriptor[]> {
    return this.allScheduledTasks;
  }

  getRouter(_events: EventsService): express.Router {
    const router = Router();

    router.route('/.roadie/scheduler/v1/tasks').get(async (req, res) => {
      const { all } = req.query;
      const globalState = await TaskWorker.taskStates(
        await this.databaseFactory(),
      );

      const enhancedTaskInfo = new Map<string, EnhancedTaskInfo>();
      if (this.taskInfoEnhancer) {
        const enhancerResult = await this.taskInfoEnhancer(
          this.allScheduledTasks,
        );
        enhancerResult.forEach(taskInfo => {
          enhancedTaskInfo.set(taskInfo.id, taskInfo);
        });
      }
      const tasks = this.constructTasksForDisplay(
        globalState,
        enhancedTaskInfo,
      );
      if (all === 'true') {
        res.json({ tasks });
      } else {
        res.json({ tasks: tasks.filter(filterTasks) });
      }
    });

    router
      .route('/.roadie/scheduler/v1/tasks/:id/trigger')
      .post(async (req, res) => {
        const { id } = req.params;
        await this.triggerTask(id);
        res.status(200).end();
      });

    return router;
  }

  private constructTasksForDisplay(
    globalState: Map<string, TaskApiTasksResponse['taskState']>,
    enhancedTaskInfo: Map<string, EnhancedTaskInfo>,
  ) {
    const tasks = new Array<TaskApiTasksResponse>();
    for (const task of this.allScheduledTasks) {
      tasks.push({
        taskId: enhancedTaskInfo.has(task.id)
          ? enhancedTaskInfo.get(task.id)!.name
          : task.id,
        description: enhancedTaskInfo.has(task.id)
          ? enhancedTaskInfo.get(task.id)!.description
          : '',
        pluginId: this.pluginId,
        scope: task.scope,
        settings: task.settings,
        taskState:
          this.localWorkersById.get(task.id)?.taskState() ??
          globalState.get(task.id) ??
          null,
        workerState:
          this.localWorkersById.get(task.id)?.workerState() ??
          this.globalWorkersById.get(task.id)?.workerState() ??
          null,
      });
    }
    return tasks;
  }

  private instrumentedFunction(
    task: SchedulerServiceTaskInvocationDefinition,
    scope: string,
  ): SchedulerServiceTaskFunction {
    return async abort => {
      const labels: Record<string, string> = {
        taskId: task.id,
        scope,
      };
      this.counter.add(1, { ...labels, result: 'started' });

      this.lastStarted.record(Date.now() / 1000, { taskId: task.id });
      const startTime = process.hrtime();

      try {
        await tracer.startActiveSpan(`task ${task.id}`, async span => {
          try {
            span.setAttributes(labels);
            await task.fn(abort);
          } catch (error) {
            if (error instanceof Error) {
              span.recordException(error);
            }
            throw error;
          } finally {
            span.end();
          }
        });
        labels.result = 'completed';
      } catch (ex) {
        labels.result = 'failed';
        throw ex;
      } finally {
        const delta = process.hrtime(startTime);
        const endTime = delta[0] + delta[1] / 1e9;
        this.counter.add(1, labels);
        this.duration.record(endTime, labels);
        this.lastCompleted.record(Date.now() / 1000, labels);
      }
    };
  }
}

export function parseDuration(
  frequency: SchedulerServiceTaskScheduleDefinition['frequency'],
): string {
  if (typeof frequency === 'object' && 'cron' in frequency) {
    return frequency.cron;
  }
  if (typeof frequency === 'object' && 'trigger' in frequency) {
    return frequency.trigger;
  }

  const parsed = Duration.isDuration(frequency)
    ? frequency
    : Duration.fromObject(frequency);

  if (!parsed.isValid) {
    throw new Error(
      `Invalid duration, ${parsed.invalidReason}: ${parsed.invalidExplanation}`,
    );
  }

  return parsed.toISO()!;
}
