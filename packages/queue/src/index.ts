export type QueueBackend = 'database' | 'sqs';

export type QueueTaskMap = Record<string, () => Promise<unknown>>;

export async function executeQueueTasks(args: {
  backend: QueueBackend;
  tasks: QueueTaskMap;
}) {
  if (args.backend === 'sqs') {
    throw new Error('queue_backend_sqs_not_implemented');
  }

  const results = await Object.entries(args.tasks).reduce<Promise<Record<string, unknown>>>(
    async (previousPromise, [name, run]) => {
      const previous = await previousPromise;
      previous[name] = await run();
      return previous;
    },
    Promise.resolve({}),
  );

  return {
    backend: args.backend,
    results,
  };
}
