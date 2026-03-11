import { loadWorkerConfig } from '@vitalspace/config';
import { createDbClient } from '@vitalspace/db';
import {
  processPendingDezrezWebhookEvents,
  processPendingIntegrationJobs,
  processPendingPropertySyncs,
} from '@vitalspace/integrations';

export async function runWorkerCycle(args: {
  databaseUrl: string;
}) {
  const { db, client } = createDbClient(args.databaseUrl);

  try {
    const webhookResult = await processPendingDezrezWebhookEvents({ db });
    const integrationJobResult = await processPendingIntegrationJobs({ db });
    const propertySyncResult = await processPendingPropertySyncs({ db });

    return {
      webhookResult,
      integrationJobResult,
      propertySyncResult,
    };
  } finally {
    await client.end();
  }
}

export function startWorkerLoop(args: {
  databaseUrl: string;
  pollIntervalMs?: number;
}) {
  const pollIntervalMs = args.pollIntervalMs ?? loadWorkerConfig().pollIntervalMs;

  const tick = async () => {
    try {
      const result = await runWorkerCycle({
        databaseUrl: args.databaseUrl,
      });
      const processedCount =
        result.webhookResult.processedEvents +
        result.integrationJobResult.completedJobs +
        result.propertySyncResult.processedEvents;

      if (processedCount > 0) {
        console.log(
          `@vitalspace/worker cycle webhooks=${result.webhookResult.processedEvents} jobs=${result.integrationJobResult.completedJobs} syncs=${result.propertySyncResult.processedEvents}`,
        );
      }
    } catch (error) {
      console.error('@vitalspace/worker cycle failed', error);
    }
  };

  void tick();
  const interval = setInterval(() => {
    void tick();
  }, pollIntervalMs);
  interval.unref();
  return interval;
}
