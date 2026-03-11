import {
  dezrezIntegrationCredentialsSchema,
  dezrezIntegrationSettingsSchema,
  dezrezSeedPropertySchema,
  type DezrezSeedProperty,
} from '@vitalspace/contracts';

type FetchLike = typeof fetch;

const DEFAULT_DEZREZ_AUTH_URL = 'https://auth.dezrez.com/Dezrez.Core.Api/oauth/token/';
const DEFAULT_DEZREZ_CORE_API_URL = 'https://api.dezrez.com/api/';

function ensureTrailingSlash(value: string) {
  return value.endsWith('/') ? value : `${value}/`;
}

function buildDisplayAddress(address: Record<string, unknown> | undefined) {
  if (!address) {
    return null;
  }

  const parts = [
    typeof address.Number === 'string' ? address.Number : null,
    typeof address.BuildingName === 'string' ? address.BuildingName : null,
    typeof address.Street === 'string' ? address.Street : null,
    typeof address.Locality === 'string' ? address.Locality : null,
    typeof address.Town === 'string' ? address.Town : null,
    typeof address.Postcode === 'string' ? address.Postcode : null,
  ].filter((part): part is string => Boolean(part && part.trim().length > 0));

  if (!parts.length) {
    return null;
  }

  return parts.join(', ');
}

function sanitizeJson<T>(value: T): T {
  if (typeof value === 'string') {
    return [...value].filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127;
    }).join('') as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJson(item)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, sanitizeJson(nestedValue)]),
    ) as T;
  }

  return value;
}

function getString(value: unknown) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

export function normalizeDezrezPropertySummary(raw: Record<string, unknown>): DezrezSeedProperty | null {
  const externalId =
    getString(raw.RoleId) ??
    getString(raw.PropertyRoleId) ??
    getString(raw.MarketingRoleId);
  if (!externalId) {
    return null;
  }

  const address =
    (raw.Address && typeof raw.Address === 'object' ? (raw.Address as Record<string, unknown>) : undefined);
  const roleStatus =
    raw.RoleStatus && typeof raw.RoleStatus === 'object'
      ? (raw.RoleStatus as Record<string, unknown>)
      : undefined;

  return dezrezSeedPropertySchema.parse({
    externalId,
    propertyId: getString(raw.PropertyId) ?? undefined,
    displayAddress: buildDisplayAddress(address) ?? `Property ${externalId}`,
    postcode: getString(address?.Postcode) ?? undefined,
    status: getString(roleStatus?.SystemName) ?? getString(roleStatus?.Name) ?? 'active',
    marketingStatus: getString(roleStatus?.SystemName) ?? undefined,
    rawPayload: sanitizeJson(raw),
  });
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`dezrez_http_${response.status}:${body}`);
  }

  return sanitizeJson((await response.json()) as T);
}

function withAgencyId(url: URL, agencyId: number | undefined) {
  if (agencyId) {
    url.searchParams.set('agencyId', String(agencyId));
  }

  return url;
}

export function createDezrezClient(args: {
  settings: unknown;
  credentials?: unknown;
  env?: NodeJS.ProcessEnv;
  fetchFn?: FetchLike;
}) {
  const settings = dezrezIntegrationSettingsSchema.parse(args.settings ?? {});
  const credentials = dezrezIntegrationCredentialsSchema.parse(args.credentials ?? {});
  const env = args.env ?? process.env;
  const fetchFn = args.fetchFn ?? fetch;

  let accessToken: string | null = null;
  let accessTokenExpiresAt = 0;

  async function getAccessToken() {
    if (accessToken && accessTokenExpiresAt > Date.now()) {
      return accessToken;
    }

    const clientId = credentials.clientId ?? env.DEZREZ_CLIENT_ID;
    const clientSecret = credentials.clientSecret ?? env.DEZREZ_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error('dezrez_client_credentials_missing');
    }

    const authUrl = settings.authUrl ?? env.DEZREZ_AUTH_URL ?? DEFAULT_DEZREZ_AUTH_URL;
    const authorization = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await fetchFn(authUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authorization}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Rezi-Api-Version': '1.0',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope:
          'event_read event_write people_read people_write property_read property_write impersonate_web_user',
      }),
    });
    const body = await parseJsonResponse<{ access_token: string; expires_in?: number }>(response);
    accessToken = body.access_token;
    accessTokenExpiresAt = Date.now() + Math.max((body.expires_in ?? 3600) - 60, 60) * 1000;
    return accessToken;
  }

  async function getCore(route: string, query?: Record<string, string | number | boolean | undefined>) {
    const token = await getAccessToken();
    const coreApiUrl = ensureTrailingSlash(
      settings.coreApiUrl ?? env.DEZREZ_CORE_API_URL ?? DEFAULT_DEZREZ_CORE_API_URL,
    );
    const url = withAgencyId(new URL(route, coreApiUrl), settings.agencyId ?? Number(env.DEZREZ_AGENCY_ID));
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const response = await fetchFn(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Rezi-Api-Version': '1.0',
      },
    });
    return parseJsonResponse<Record<string, unknown>>(response);
  }

  async function searchProperties() {
    if (settings.mode === 'seed') {
      return settings.seedProperties;
    }

    const apiKey = credentials.apiKey ?? env.DEZREZ_API_KEY;
    const searchApiUrl = settings.searchApiUrl ?? env.DEZREZ_API_URL;
    if (!apiKey || !searchApiUrl) {
      throw new Error('dezrez_search_credentials_missing');
    }

    const url = new URL('search', ensureTrailingSlash(searchApiUrl));
    url.searchParams.set('APIKey', apiKey);

    const response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Rezi-Api-Version': '1.0',
      },
      body: JSON.stringify({
        MarketingFlags: 'ApprovedForMarketingWebsite',
        MinimumPrice: 0,
        MaximumPrice: 9999999,
        MinimumBedrooms: 0,
        SortBy: 0,
        PageSize: settings.pageSize,
        IncludeStc: settings.includeStc,
        BranchIdList: settings.branchIds,
        PageNumber: 1,
      }),
    });
    const body = await parseJsonResponse<{ Collection?: Array<Record<string, unknown>> }>(response);
    return (body.Collection ?? [])
      .map((property) => normalizeDezrezPropertySummary(property))
      .filter((property): property is DezrezSeedProperty => property !== null);
  }

  return {
    listPropertiesForSync: searchProperties,
    getRole(roleId: string) {
      return getCore(`role/${roleId}`);
    },
    async getRoleOffers(roleId: string) {
      if (settings.mode === 'seed') {
        return settings.seedOffersByRoleId[roleId] ?? [];
      }

      return getCore(`role/${roleId}/offers`);
    },
    async getRoleViewings(roleId: string) {
      if (settings.mode === 'seed') {
        return settings.seedViewingDetailsByRoleId[roleId] ?? settings.seedViewingsByRoleId[roleId] ?? [];
      }

      return getCore(`role/${roleId}/viewings`);
    },
    async getRoleViewingsBasic(roleId: string) {
      if (settings.mode === 'seed') {
        return settings.seedViewingsByRoleId[roleId] ?? [];
      }

      return getCore(`role/${roleId}/viewingsbasic`);
    },
    async getRoleEvents(roleId: string) {
      if (settings.mode === 'seed') {
        return settings.seedEventsByRoleId[roleId] ?? [];
      }

      return getCore(`role/${roleId}/events`, { pageSize: 2000 });
    },
    getProperty(propertyId: string) {
      return getCore(`property/${propertyId}`);
    },
    getPropertyOwners(propertyId: string) {
      return getCore(`property/${propertyId}/owners`);
    },
  };
}

export type DezrezClient = ReturnType<typeof createDezrezClient>;
