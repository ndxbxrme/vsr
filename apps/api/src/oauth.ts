import { createHmac } from 'node:crypto';
import { encryptJsonPayload, normalizeEmail } from '@vitalspace/auth';

const DEFAULT_GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const DEFAULT_GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export type OAuthProviderProfile = {
  providerUserId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  profile: Record<string, unknown>;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
};

function getSessionSecret() {
  return process.env.SESSION_SECRET ?? 'change-me';
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

type OAuthState = {
  provider: 'google';
  redirectTo: string;
};

export function createOAuthState(payload: OAuthState) {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac('sha256', getSessionSecret()).update(encodedPayload).digest('hex');
  return `${encodedPayload}.${signature}`;
}

export function parseOAuthState(state: string): OAuthState | null {
  const [encodedPayload, signature] = state.split('.');
  if (!encodedPayload || !signature) {
    return null;
  }

  const expected = createHmac('sha256', getSessionSecret()).update(encodedPayload).digest('hex');
  if (expected !== signature) {
    return null;
  }

  return JSON.parse(base64UrlDecode(encodedPayload)) as OAuthState;
}

function getGoogleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('google_oauth_not_configured');
  }

  return {
    clientId,
    clientSecret,
    authUrl: process.env.GOOGLE_AUTH_URL ?? DEFAULT_GOOGLE_AUTH_URL,
    tokenUrl: process.env.GOOGLE_TOKEN_URL ?? DEFAULT_GOOGLE_TOKEN_URL,
    userInfoUrl: process.env.GOOGLE_USERINFO_URL ?? DEFAULT_GOOGLE_USERINFO_URL,
  };
}

export function buildGoogleAuthorizationUrl(args: {
  callbackUrl: string;
  redirectTo: string;
}) {
  const config = getGoogleConfig();
  const url = new URL(config.authUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', args.callbackUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set(
    'state',
    createOAuthState({
      provider: 'google',
      redirectTo: args.redirectTo,
    }),
  );
  return url.toString();
}

export async function exchangeGoogleCode(args: {
  code: string;
  callbackUrl: string;
}): Promise<OAuthProviderProfile> {
  const config = getGoogleConfig();
  const tokenResponse = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code: args.code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: args.callbackUrl,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error(`google_token_exchange_failed_${tokenResponse.status}`);
  }

  const tokenJson = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const userInfoResponse = await fetch(config.userInfoUrl, {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
    },
  });

  if (!userInfoResponse.ok) {
    throw new Error(`google_userinfo_failed_${userInfoResponse.status}`);
  }

  const userInfo = (await userInfoResponse.json()) as Record<string, unknown>;
  const email =
    typeof userInfo.email === 'string' && userInfo.email.trim().length > 0
      ? normalizeEmail(userInfo.email)
      : null;

  return {
    providerUserId:
      typeof userInfo.sub === 'string' ? userInfo.sub : typeof userInfo.id === 'string' ? userInfo.id : '',
    email,
    firstName: typeof userInfo.given_name === 'string' ? userInfo.given_name : null,
    lastName: typeof userInfo.family_name === 'string' ? userInfo.family_name : null,
    displayName: typeof userInfo.name === 'string' ? userInfo.name : null,
    profile: userInfo,
    accessToken: tokenJson.access_token ?? null,
    refreshToken: tokenJson.refresh_token ?? null,
    expiresAt:
      typeof tokenJson.expires_in === 'number'
        ? new Date(Date.now() + tokenJson.expires_in * 1000)
        : null,
  };
}

export function maybeEncryptToken(value: string | null) {
  if (!value) {
    return null;
  }

  const secret = process.env.APP_ENCRYPTION_KEY;
  if (!secret) {
    return null;
  }

  return JSON.stringify(encryptJsonPayload(value, secret));
}
