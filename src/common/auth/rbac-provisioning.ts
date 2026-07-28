import { Prisma, UserRole } from '@prisma/client';
import {
  PERMISSION_CATALOG,
  SYSTEM_ROLE_DEFINITIONS,
} from './permission.constants';

export async function provisionTenantRbac(
  tx: Prisma.TransactionClient,
  tenantId: string,
  adminUserId: string,
): Promise<void> {
  await tx.permission.createMany({
    data: PERMISSION_CATALOG.map((permission) => ({ ...permission })),
    skipDuplicates: true,
  });

  const permissions = await tx.permission.findMany({
    where: {
      key: { in: PERMISSION_CATALOG.map((permission) => permission.key) },
    },
    select: { id: true, key: true },
  });
  const permissionIdByKey = new Map(
    permissions.map((permission) => [permission.key, permission.id]),
  );

  let adminRoleId: string | undefined;
  for (const definition of SYSTEM_ROLE_DEFINITIONS) {
    const role = await tx.role.create({
      data: {
        tenantId,
        name: definition.name,
        slug: definition.slug,
        rank: definition.rank,
        isSystem: true,
        systemRole: definition.systemRole,
        permissions: {
          create: definition.permissionKeys.map((key) => ({
            permissionId: requiredPermissionId(permissionIdByKey, key),
          })),
        },
      },
      select: { id: true, systemRole: true },
    });
    if (role.systemRole === UserRole.ADMIN) {
      adminRoleId = role.id;
    }
  }

  if (!adminRoleId) {
    throw new Error('Le rôle ADMIN du tenant n’a pas pu être provisionné');
  }
  await tx.userRoleAssignment.create({
    data: {
      userId: adminUserId,
      roleId: adminRoleId,
      assignedById: adminUserId,
    },
  });
}

function requiredPermissionId(
  permissionIdByKey: ReadonlyMap<string, string>,
  key: string,
): string {
  const permissionId = permissionIdByKey.get(key);
  if (!permissionId) {
    throw new Error(`Permission absente du catalogue : ${key}`);
  }
  return permissionId;
}
