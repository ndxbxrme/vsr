import { describe, expect, it } from 'vitest';
import { executeQueueTasks } from './index';

describe('executeQueueTasks', () => {
  it('runs database-backed queue tasks in order', async () => {
    const calls: string[] = [];

    const result = await executeQueueTasks({
      backend: 'database',
      tasks: {
        first: async () => {
          calls.push('first');
          return 1;
        },
        second: async () => {
          calls.push('second');
          return 2;
        },
      },
    });

    expect(calls).toEqual(['first', 'second']);
    expect(result).toEqual({
      backend: 'database',
      results: {
        first: 1,
        second: 2,
      },
    });
  });

  it('fails loudly for sqs until that backend is implemented', async () => {
    await expect(
      executeQueueTasks({
        backend: 'sqs',
        tasks: {},
      }),
    ).rejects.toThrow('queue_backend_sqs_not_implemented');
  });
});
