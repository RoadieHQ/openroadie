import { TaskApiTasksResponse } from './types';

const blockedTasks = [
  'run_tidy_tmp',
  'contributing_users_statistics_task',
  'monitor-refresh-state',
];

export const filterTasks = (task: TaskApiTasksResponse) => {
  if (blockedTasks.includes(task.taskId)) {
    return false;
  }
  return true;
};
