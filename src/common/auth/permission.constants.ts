import { UserRole } from '@prisma/client';

export const PERMISSIONS = {
  USERS_READ: 'users.read',
  USERS_INVITE: 'users.invite',
  USERS_UPDATE: 'users.update',
  USERS_CHANGE_STATUS: 'users.change-status',
  USERS_ASSIGN_ROLES: 'users.assign-roles',
  USERS_REVOKE_SESSIONS: 'users.revoke-sessions',
  ROLES_READ: 'roles.read',
  ROLES_CREATE: 'roles.create',
  ROLES_UPDATE: 'roles.update',
  ROLES_DELETE: 'roles.delete',
  ROLES_MANAGE_PERMISSIONS: 'roles.manage-permissions',
  PERMISSIONS_READ: 'permissions.read',
  AUDIT_READ: 'audit.read',
  PRODUCTS_READ: 'products.read',
  PRODUCTS_CREATE: 'products.create',
  PRODUCTS_UPDATE: 'products.update',
  PRODUCTS_ARCHIVE: 'products.archive',
  QUOTES_READ: 'quotes.read',
  QUOTES_CREATE: 'quotes.create',
  QUOTES_UPDATE: 'quotes.update',
  QUOTES_DELETE: 'quotes.delete',
  QUOTES_SEND: 'quotes.send',
  QUOTES_CHANGE_STATUS: 'quotes.change-status',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface PermissionDefinition {
  key: PermissionKey;
  name: string;
  description: string;
  resource: string;
  action: string;
}

export const PERMISSION_CATALOG: readonly PermissionDefinition[] = [
  {
    key: PERMISSIONS.USERS_READ,
    name: 'Consulter les utilisateurs',
    description: 'Lister et consulter les collaborateurs du tenant.',
    resource: 'users',
    action: 'read',
  },
  {
    key: PERMISSIONS.USERS_INVITE,
    name: 'Inviter des utilisateurs',
    description: 'Envoyer et révoquer des invitations.',
    resource: 'users',
    action: 'invite',
  },
  {
    key: PERMISSIONS.USERS_UPDATE,
    name: 'Modifier les utilisateurs',
    description: 'Modifier les informations personnelles des collaborateurs.',
    resource: 'users',
    action: 'update',
  },
  {
    key: PERMISSIONS.USERS_CHANGE_STATUS,
    name: 'Activer ou désactiver les utilisateurs',
    description: 'Suspendre ou réactiver un compte du tenant.',
    resource: 'users',
    action: 'change-status',
  },
  {
    key: PERMISSIONS.USERS_ASSIGN_ROLES,
    name: 'Affecter des rôles',
    description: 'Remplacer les rôles attribués à un collaborateur.',
    resource: 'users',
    action: 'assign-roles',
  },
  {
    key: PERMISSIONS.USERS_REVOKE_SESSIONS,
    name: 'Révoquer les sessions',
    description: 'Déconnecter un collaborateur de tous ses appareils.',
    resource: 'users',
    action: 'revoke-sessions',
  },
  {
    key: PERMISSIONS.ROLES_READ,
    name: 'Consulter les rôles',
    description: 'Lister les rôles et leurs permissions.',
    resource: 'roles',
    action: 'read',
  },
  {
    key: PERMISSIONS.ROLES_CREATE,
    name: 'Créer des rôles',
    description: 'Créer un rôle personnalisé dans le tenant.',
    resource: 'roles',
    action: 'create',
  },
  {
    key: PERMISSIONS.ROLES_UPDATE,
    name: 'Modifier les rôles',
    description: 'Modifier un rôle personnalisé.',
    resource: 'roles',
    action: 'update',
  },
  {
    key: PERMISSIONS.ROLES_DELETE,
    name: 'Supprimer les rôles',
    description: 'Supprimer un rôle personnalisé inutilisé.',
    resource: 'roles',
    action: 'delete',
  },
  {
    key: PERMISSIONS.ROLES_MANAGE_PERMISSIONS,
    name: 'Gérer les permissions des rôles',
    description: 'Remplacer les permissions d’un rôle personnalisé.',
    resource: 'roles',
    action: 'manage-permissions',
  },
  {
    key: PERMISSIONS.PERMISSIONS_READ,
    name: 'Consulter les permissions',
    description: 'Consulter le catalogue global des permissions.',
    resource: 'permissions',
    action: 'read',
  },
  {
    key: PERMISSIONS.AUDIT_READ,
    name: 'Consulter le journal d’audit',
    description: 'Lire les événements sensibles du tenant.',
    resource: 'audit',
    action: 'read',
  },
  {
    key: PERMISSIONS.PRODUCTS_READ,
    name: 'Consulter le catalogue',
    description: 'Lister et consulter les produits et services du tenant.',
    resource: 'products',
    action: 'read',
  },
  {
    key: PERMISSIONS.PRODUCTS_CREATE,
    name: 'Créer des articles',
    description: 'Créer des produits et services dans le catalogue.',
    resource: 'products',
    action: 'create',
  },
  {
    key: PERMISSIONS.PRODUCTS_UPDATE,
    name: 'Modifier le catalogue',
    description: 'Modifier les produits et services actifs.',
    resource: 'products',
    action: 'update',
  },
  {
    key: PERMISSIONS.PRODUCTS_ARCHIVE,
    name: 'Archiver le catalogue',
    description: 'Archiver ou restaurer des produits et services.',
    resource: 'products',
    action: 'archive',
  },
  {
    key: PERMISSIONS.QUOTES_READ,
    name: 'Consulter les devis',
    description: 'Lister et consulter les devis du tenant.',
    resource: 'quotes',
    action: 'read',
  },
  {
    key: PERMISSIONS.QUOTES_CREATE,
    name: 'Créer des devis',
    description: 'Créer des devis et leurs lignes commerciales.',
    resource: 'quotes',
    action: 'create',
  },
  {
    key: PERMISSIONS.QUOTES_UPDATE,
    name: 'Modifier les devis',
    description: 'Modifier les devis encore au brouillon.',
    resource: 'quotes',
    action: 'update',
  },
  {
    key: PERMISSIONS.QUOTES_DELETE,
    name: 'Supprimer les brouillons',
    description: 'Supprimer définitivement un devis au brouillon.',
    resource: 'quotes',
    action: 'delete',
  },
  {
    key: PERMISSIONS.QUOTES_SEND,
    name: 'Envoyer les devis',
    description: 'Faire passer un devis du brouillon au statut envoyé.',
    resource: 'quotes',
    action: 'send',
  },
  {
    key: PERMISSIONS.QUOTES_CHANGE_STATUS,
    name: 'Changer le statut des devis',
    description: 'Accepter, refuser, expirer ou annuler un devis.',
    resource: 'quotes',
    action: 'change-status',
  },
];

export const SYSTEM_ROLE_DEFINITIONS: ReadonlyArray<{
  systemRole: UserRole;
  name: string;
  slug: string;
  rank: number;
  permissionKeys: readonly PermissionKey[];
}> = [
  {
    systemRole: UserRole.ADMIN,
    name: 'Administrateur',
    slug: 'admin',
    rank: 100,
    permissionKeys: Object.values(PERMISSIONS),
  },
  {
    systemRole: UserRole.MANAGER,
    name: 'Manager',
    slug: 'manager',
    rank: 50,
    permissionKeys: [
      PERMISSIONS.USERS_READ,
      PERMISSIONS.USERS_INVITE,
      PERMISSIONS.USERS_UPDATE,
      PERMISSIONS.ROLES_READ,
      PERMISSIONS.PERMISSIONS_READ,
      PERMISSIONS.PRODUCTS_READ,
      PERMISSIONS.PRODUCTS_CREATE,
      PERMISSIONS.PRODUCTS_UPDATE,
      PERMISSIONS.PRODUCTS_ARCHIVE,
      PERMISSIONS.QUOTES_READ,
      PERMISSIONS.QUOTES_CREATE,
      PERMISSIONS.QUOTES_UPDATE,
      PERMISSIONS.QUOTES_DELETE,
      PERMISSIONS.QUOTES_SEND,
      PERMISSIONS.QUOTES_CHANGE_STATUS,
    ],
  },
  {
    systemRole: UserRole.USER,
    name: 'Utilisateur',
    slug: 'user',
    rank: 10,
    permissionKeys: [
      PERMISSIONS.PRODUCTS_READ,
      PERMISSIONS.QUOTES_READ,
      PERMISSIONS.QUOTES_CREATE,
      PERMISSIONS.QUOTES_UPDATE,
      PERMISSIONS.QUOTES_SEND,
    ],
  },
];
