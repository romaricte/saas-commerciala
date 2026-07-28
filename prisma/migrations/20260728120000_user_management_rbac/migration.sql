-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "resource" VARCHAR(60) NOT NULL,
    "action" VARCHAR(60) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500),
    "rank" INTEGER NOT NULL DEFAULT 1,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "system_role" "UserRole",
    "tenant_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id", "permission_id")
);

-- CreateTable
CREATE TABLE "user_role_assignments" (
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "assigned_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_role_assignments_pkey" PRIMARY KEY ("user_id", "role_id")
);

-- CreateTable
CREATE TABLE "user_invitations" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" VARCHAR(80) NOT NULL,
    "last_name" VARCHAR(80) NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "invited_by_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation_roles" (
    "invitation_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,

    CONSTRAINT "invitation_roles_pkey" PRIMARY KEY ("invitation_id", "role_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "target_type" VARCHAR(60) NOT NULL,
    "target_id" TEXT,
    "metadata" JSONB,
    "tenant_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");
CREATE INDEX "permissions_resource_idx" ON "permissions"("resource");
CREATE UNIQUE INDEX "roles_tenant_id_slug_key" ON "roles"("tenant_id", "slug");
CREATE UNIQUE INDEX "roles_tenant_id_system_role_key" ON "roles"("tenant_id", "system_role");
CREATE INDEX "roles_tenant_id_rank_idx" ON "roles"("tenant_id", "rank");
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");
CREATE INDEX "user_role_assignments_role_id_idx" ON "user_role_assignments"("role_id");
CREATE INDEX "user_role_assignments_assigned_by_id_idx" ON "user_role_assignments"("assigned_by_id");
CREATE UNIQUE INDEX "user_invitations_token_hash_key" ON "user_invitations"("token_hash");
CREATE INDEX "user_invitations_tenant_id_email_idx" ON "user_invitations"("tenant_id", "email");
CREATE INDEX "user_invitations_expires_at_idx" ON "user_invitations"("expires_at");
CREATE INDEX "invitation_roles_role_id_idx" ON "invitation_roles"("role_id");
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs"("actor_user_id");

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey"
FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey"
FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_role_id_fkey"
FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_assigned_by_id_fkey"
FOREIGN KEY ("assigned_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_invited_by_id_fkey"
FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "invitation_roles" ADD CONSTRAINT "invitation_roles_invitation_id_fkey"
FOREIGN KEY ("invitation_id") REFERENCES "user_invitations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "invitation_roles" ADD CONSTRAINT "invitation_roles_role_id_fkey"
FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey"
FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SeedPermissionCatalog
INSERT INTO "permissions" ("id", "key", "name", "description", "resource", "action") VALUES
('perm:users.read', 'users.read', 'Consulter les utilisateurs', 'Lister et consulter les collaborateurs du tenant.', 'users', 'read'),
('perm:users.invite', 'users.invite', 'Inviter des utilisateurs', 'Envoyer et révoquer des invitations.', 'users', 'invite'),
('perm:users.update', 'users.update', 'Modifier les utilisateurs', 'Modifier les informations personnelles des collaborateurs.', 'users', 'update'),
('perm:users.change-status', 'users.change-status', 'Activer ou désactiver les utilisateurs', 'Suspendre ou réactiver un compte du tenant.', 'users', 'change-status'),
('perm:users.assign-roles', 'users.assign-roles', 'Affecter des rôles', 'Remplacer les rôles attribués à un collaborateur.', 'users', 'assign-roles'),
('perm:users.revoke-sessions', 'users.revoke-sessions', 'Révoquer les sessions', 'Déconnecter un collaborateur de tous ses appareils.', 'users', 'revoke-sessions'),
('perm:roles.read', 'roles.read', 'Consulter les rôles', 'Lister les rôles et leurs permissions.', 'roles', 'read'),
('perm:roles.create', 'roles.create', 'Créer des rôles', 'Créer un rôle personnalisé dans le tenant.', 'roles', 'create'),
('perm:roles.update', 'roles.update', 'Modifier les rôles', 'Modifier un rôle personnalisé.', 'roles', 'update'),
('perm:roles.delete', 'roles.delete', 'Supprimer les rôles', 'Supprimer un rôle personnalisé inutilisé.', 'roles', 'delete'),
('perm:roles.manage-permissions', 'roles.manage-permissions', 'Gérer les permissions des rôles', 'Remplacer les permissions d’un rôle personnalisé.', 'roles', 'manage-permissions'),
('perm:permissions.read', 'permissions.read', 'Consulter les permissions', 'Consulter le catalogue global des permissions.', 'permissions', 'read'),
('perm:audit.read', 'audit.read', 'Consulter le journal d’audit', 'Lire les événements sensibles du tenant.', 'audit', 'read')
ON CONFLICT ("key") DO NOTHING;

-- ProvisionSystemRolesForExistingTenants
INSERT INTO "roles" ("id", "tenant_id", "name", "slug", "rank", "is_system", "system_role", "updated_at")
SELECT 'role:' || "id" || ':admin', "id", 'Administrateur', 'admin', 100, true, 'ADMIN'::"UserRole", CURRENT_TIMESTAMP FROM "tenants"
UNION ALL
SELECT 'role:' || "id" || ':manager', "id", 'Manager', 'manager', 50, true, 'MANAGER'::"UserRole", CURRENT_TIMESTAMP FROM "tenants"
UNION ALL
SELECT 'role:' || "id" || ':user', "id", 'Utilisateur', 'user', 10, true, 'USER'::"UserRole", CURRENT_TIMESTAMP FROM "tenants";

-- ADMIN receives every permission.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT "roles"."id", "permissions"."id"
FROM "roles"
CROSS JOIN "permissions"
WHERE "roles"."system_role" = 'ADMIN';

-- MANAGER receives the limited collaboration permissions.
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT "roles"."id", "permissions"."id"
FROM "roles"
JOIN "permissions" ON "permissions"."key" IN (
  'users.read',
  'users.invite',
  'users.update',
  'roles.read',
  'permissions.read'
)
WHERE "roles"."system_role" = 'MANAGER';

-- Backfill role assignments from the legacy coarse role.
INSERT INTO "user_role_assignments" ("user_id", "role_id", "assigned_by_id")
SELECT "users"."id", "roles"."id", "users"."id"
FROM "users"
JOIN "roles"
  ON "roles"."tenant_id" = "users"."tenant_id"
 AND "roles"."system_role" = "users"."role"
WHERE "users"."tenant_id" IS NOT NULL
  AND "users"."role" <> 'SUPER_ADMIN';
