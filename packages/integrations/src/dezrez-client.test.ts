import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  createDezrezClient,
  extractDezrezPropertyAddress,
  isPlaceholderPropertyDisplayAddress,
  normalizeDezrezPropertySummary,
} from './dezrez-client';

const sampleProperties = JSON.parse(
  readFileSync(new URL('../../../sources/data/properties-selling.json', import.meta.url), 'utf8'),
) as Array<Record<string, unknown>>;

describe('dezrez client adapter', () => {
  it('normalizes a Dezrez search property into the internal sync shape', () => {
    const normalized = normalizeDezrezPropertySummary(sampleProperties[0] ?? {});

    expect(normalized).toMatchObject({
      externalId: '30026645',
      propertyId: '3671906',
      postcode: 'M16 9GZ',
      marketingStatus: 'InstructionToLet',
    });
    expect(normalized?.displayAddress).toContain('The Pulse');
  });

  it('prefers role ids over raw Id when normalizing role detail payloads', () => {
    const normalized = normalizeDezrezPropertySummary({
      Id: 3671906,
      RoleId: 30026645,
      PropertyId: 3671906,
      DisplayAddress: 'The Pulse, 50 Seymour Grove, Manchester, M16 9GZ',
      RoleStatus: {
        SystemName: 'InstructionToLet',
      },
    });

    expect(normalized).toMatchObject({
      externalId: '30026645',
      propertyId: '3671906',
    });
  });

  it('detects placeholder addresses and extracts a better address from property payloads', () => {
    expect(isPlaceholderPropertyDisplayAddress('Property 30026645')).toBe(true);
    expect(isPlaceholderPropertyDisplayAddress('The Pulse, 50 Seymour Grove')).toBe(false);
    expect(
      extractDezrezPropertyAddress({
        Address: {
          BuildingName: 'The Pulse',
          Street: '50 Seymour Grove',
          Town: 'Manchester',
          Postcode: 'M16 0LN',
        },
      }),
    ).toEqual({
      displayAddress: 'The Pulse, 50 Seymour Grove, Manchester, M16 0LN',
      postcode: 'M16 0LN',
    });
  });

  it('returns seeded properties in seed mode', async () => {
    const client = createDezrezClient({
      settings: {
        mode: 'seed',
        seedProperties: [
          {
            externalId: 'DRZ-1',
            displayAddress: '1 Seed Street',
          },
        ],
      },
    });

    await expect(client.listPropertiesForSync()).resolves.toMatchObject([
      {
        externalId: 'DRZ-1',
        displayAddress: '1 Seed Street',
      },
    ]);
  });

  it('fetches live property search results and normalizes them', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            Collection: sampleProperties.slice(0, 2),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    const client = createDezrezClient({
      settings: {
        mode: 'live',
        searchApiUrl: 'https://search.dezrez.example/api/',
      },
      credentials: {
        apiKey: 'search-api-key',
      },
      fetchFn,
    });

    const properties = await client.listPropertiesForSync();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain('APIKey=search-api-key');
    expect(properties).toHaveLength(2);
    expect(properties[0]?.externalId).toBe('30026645');
  });

  it('uses OAuth credentials for core API requests', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'token-123', expires_in: 3600 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ Id: 30026645 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const client = createDezrezClient({
      settings: {
        mode: 'live',
        authUrl: 'https://auth.dezrez.example/oauth/token/',
        coreApiUrl: 'https://core.dezrez.example/api/',
        agencyId: 37,
      },
      credentials: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
      },
      fetchFn,
    });

    const role = await client.getRole('30026645');

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(String(fetchFn.mock.calls[1]?.[0])).toContain('/role/30026645');
    expect(String(fetchFn.mock.calls[1]?.[0])).toContain('agencyId=37');
    expect(role).toMatchObject({ Id: 30026645 });
  });
});
