import { and, eq } from 'drizzle-orm';
import { type createDbClient, schema } from '@vitalspace/db';

type DbClient = ReturnType<typeof createDbClient>['db'];

function normalizeHost(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  return value.split(':')[0]?.trim().toLowerCase() ?? null;
}

export async function resolveTenantFromHost(args: {
  db: DbClient;
  host: string | null | undefined;
}) {
  const normalizedHost = normalizeHost(args.host);
  if (!normalizedHost) {
    return null;
  }

  const [customDomain] = await args.db
    .select({
      tenantId: schema.tenants.id,
      tenantName: schema.tenants.name,
      tenantSlug: schema.tenants.slug,
      domain: schema.tenantDomains.domain,
    })
    .from(schema.tenantDomains)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.tenantDomains.tenantId))
    .where(
      and(
        eq(schema.tenantDomains.domain, normalizedHost),
        eq(schema.tenantDomains.verificationStatus, 'verified'),
      ),
    )
    .limit(1);

  if (customDomain) {
    return {
      id: customDomain.tenantId,
      name: customDomain.tenantName,
      slug: customDomain.tenantSlug,
      host: customDomain.domain,
      strategy: 'custom_domain' as const,
    };
  }

  const localSuffixes = ['.localhost', '.lvh.me'];
  const localSuffix = localSuffixes.find((suffix) => normalizedHost.endsWith(suffix));
  if (!localSuffix) {
    return null;
  }

  const slug = normalizedHost.slice(0, normalizedHost.length - localSuffix.length);
  if (!slug || slug.includes('.')) {
    return null;
  }

  const [tenant] = await args.db
    .select({
      id: schema.tenants.id,
      name: schema.tenants.name,
      slug: schema.tenants.slug,
    })
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, slug))
    .limit(1);

  if (!tenant) {
    return null;
  }

  return {
    ...tenant,
    host: normalizedHost,
    strategy: 'subdomain' as const,
  };
}
