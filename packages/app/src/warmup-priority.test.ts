import { describe, expect, it, vi } from 'vitest';
import { createWarmupPriority } from './warmup-priority';

describe('warmup priority', () => {
  it('starts idle work immediately when foreground navigation is idle', async () => {
    const priority = createWarmupPriority();
    const task = vi.fn().mockResolvedValue('done');

    await expect(priority.run(task)).resolves.toBe('done');

    expect(task).toHaveBeenCalledOnce();
  });

  it('waits to start new idle work until foreground navigation finishes', async () => {
    const priority = createWarmupPriority();
    const task = vi.fn().mockResolvedValue('done');
    priority.setForegroundActive(true);

    const result = priority.run(task);
    await Promise.resolve();
    expect(task).not.toHaveBeenCalled();

    priority.setForegroundActive(false);
    await expect(result).resolves.toBe('done');
    expect(task).toHaveBeenCalledOnce();
  });

  it('keeps waiting when another navigation starts before work resumes', async () => {
    const priority = createWarmupPriority();
    const task = vi.fn().mockResolvedValue('done');
    priority.setForegroundActive(true);

    const result = priority.run(task);
    priority.setForegroundActive(false);
    priority.setForegroundActive(true);
    await Promise.resolve();
    expect(task).not.toHaveBeenCalled();

    priority.setForegroundActive(false);
    await expect(result).resolves.toBe('done');
  });
});
