import { hashOpaqueToken } from '@vitalspace/auth';
import { type createDbClient, schema } from '@vitalspace/db';
import { and, eq, gt, isNull } from 'drizzle-orm';

type DbClient = ReturnType<typeof createDbClient>['db'];

export type AuthenticatedRole = {
  tenantId: string | null;
  key: string;
};

export type AuthenticatedMembership = {
  membershipId: string;
  tenantId: string;
  branchId: string | null;
  roles: AuthenticatedRole[];
};

export type AuthenticatedContext = {
  userId: string;
  email: string | null;
  memberships: AuthenticatedMembership[];
};

export async function loadAuthContext(
  db: DbClient,
  token: string,
): Promise<AuthenticatedContext | null> {
  const now = new Date();
  const tokenHash = hashOpaqueToken(token);
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.sessionTokenHash, tokenHash),
        isNull(schema.sessions.revokedAt),
        gt(schema.sessions.expiresAt, now),
      ),
    )
    .limit(1);

  if (!session) {
    return null;
  }

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);
  if (!user) {
    return null;
  }

  const memberships = await db
    .select({
      membershipId: schema.memberships.id,
      tenantId: schema.memberships.tenantId,
      branchId: schema.memberships.branchId,
      roleTenantId: schema.roles.tenantId,
      roleKey: schema.roles.key,
    })
    .from(schema.memberships)
    .leftJoin(
      schema.membershipRoles,
      eq(schema.membershipRoles.membershipId, schema.memberships.id),
    )
    .leftJoin(schema.roles, eq(schema.roles.id, schema.membershipRoles.roleId))
    .where(
      and(
        eq(schema.memberships.userId, user.id),
        eq(schema.memberships.status, 'active'),
      ),
    );

  const groupedMemberships = new Map<string, AuthenticatedMembership>();
  for (const membership of memberships) {
    const existing = groupedMemberships.get(membership.membershipId);
    if (existing) {
      if (membership.roleKey) {
        existing.roles.push({
          tenantId: membership.roleTenantId,
          key: membership.roleKey,
        });
      }
      continue;
    }

    groupedMemberships.set(membership.membershipId, {
      membershipId: membership.membershipId,
      tenantId: membership.tenantId,
      branchId: membership.branchId,
      roles: membership.roleKey
        ? [
            {
              tenantId: membership.roleTenantId,
              key: membership.roleKey,
            },
          ]
        : [],
    });
  }

  await db
    .update(schema.sessions)
    .set({
      lastSeenAt: now,
    })
    .where(eq(schema.sessions.id, session.id));

  return {
    userId: user.id,
    email: user.email,
    memberships: [...groupedMemberships.values()],
  };
}

export function hasTenantRole(
  auth: AuthenticatedContext,
  tenantId: string,
  roleKey: string,
) {
  return auth.memberships.some(
    (membership) =>
      membership.tenantId === tenantId &&
      membership.roles.some((role) => role.key === roleKey),
  );
}
