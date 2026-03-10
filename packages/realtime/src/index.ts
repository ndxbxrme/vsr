import type { EntityChangedEvent } from '@vitalspace/contracts';

type BuildEntityChangedEventInput = Omit<EntityChangedEvent, 'occurredAt'>;

export function buildTenantRoom(tenantId: string) {
  return `tenant:${tenantId}`;
}

export function buildEntityChangedEvent(
  input: BuildEntityChangedEventInput,
): EntityChangedEvent {
  return {
    ...input,
    occurredAt: new Date().toISOString(),
  };
}
