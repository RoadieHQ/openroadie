import {
  SchedulerService,
  SchedulerServiceTaskDescriptor,
} from '@roadiehq/extensions-api';

export type EnhancedTaskInfo = {
  id: string;
  name: string;
  description?: string;
};

export type TaskInfoEnhancer = (
  tasks: SchedulerServiceTaskDescriptor[],
) => Promise<EnhancedTaskInfo[]>;

export interface RoadieSchedulerService extends SchedulerService {
  setTaskInfoEnhancer(enhancer: TaskInfoEnhancer): void;
}
