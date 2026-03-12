import { loadWorkerConfig } from '@vitalspace/config';
import { createDbClient } from '@vitalspace/db';
import {
  processPendingDezrezWebhookEvents,
  processPendingIntegrationJobs,
  processPendingPropertySyncs,
} from '@vitalspace/integrations';
import { executeQueueTasks, type QueueBackend } from '@vitalspace/queue';

export async function runWorkerCycle(args: {
  databaseUrl: string;
  queueBackend?: QueueBackend;
}) {
  const { db, client } = createDbClient(args.databaseUrl);

  try {
    const execution = await executeQueueTasks({
      backend: args.queueBackend ?? loadWorkerConfig().queueBackend,
      tasks: {
        webhookResult: () => processPendingDezrezWebhookEvents({ db }),
        integrationJobResult: () => processPendingIntegrationJobs({ db }),
        propertySyncResult: () => processPendingPropertySyncs({ db }),
      },
    });

    return {
      backend: execution.backend,
      webhookResult: execution.results.webhookResult as Awaited<
        ReturnType<typeof processPendingDezrezWebhookEvents>
      >,
      integrationJobResult: execution.results.integrationJobResult as Awaited<
        ReturnType<typeof processPendingIntegrationJobs>
      >,
      propertySyncResult: execution.results.propertySyncResult as Awaited<
        ReturnType<typeof processPendingPropertySyncs>
      >,
    };
  } finally {
    await client.end();
  }
}

export function startWorkerLoop(args: {
  databaseUrl: string;
  pollIntervalMs?: number;
  queueBackend?: QueueBackend;
}) {
  const config = loadWorkerConfig();
  const pollIntervalMs = args.pollIntervalMs ?? config.pollIntervalMs;
  const queueBackend = args.queueBackend ?? config.queueBackend;
  let inFlight = false;

  const tick = async () => {
    if (inFlight) {
      return;
    }

    inFlight = true;
    try {
      const result = await runWorkerCycle({
        databaseUrl: args.databaseUrl,
        queueBackend,
      });
      const processedCount =
        result.webhookResult.processedEvents +
        result.integrationJobResult.completedJobs +
        result.propertySyncResult.processedEvents;

      if (processedCount > 0) {
        console.log(
          `@vitalspace/worker backend=${result.backend} cycle webhooks=${result.webhookResult.processedEvents} jobs=${result.integrationJobResult.completedJobs} syncs=${result.propertySyncResult.processedEvents}`,
        );
      }
    } catch (error) {
      console.error('@vitalspace/worker cycle failed', error);
    } finally {
      inFlight = false;
    }
  };

  void tick();
  const interval = setInterval(() => {
    void tick();
  }, pollIntervalMs);
  return interval;
}
