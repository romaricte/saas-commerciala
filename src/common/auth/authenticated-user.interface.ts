import { UserRole } from '@prisma/client';

export interface AuthenticatedRole {
  id: string;
  name: string;
  slug: string;
  rank: number;
  systemRole: UserRole | null;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  tenantId: string | null;
  sessionId: string;
  emailVerified: boolean;
  roles: AuthenticatedRole[];
  permissions: string[];
}

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  email: string;
  role: UserRole;
  tenantId: string | null;
  type: 'access';
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  sub: string;
  sid: string;
  jti: string;
  type: 'refresh';
  iat?: number;
  exp?: number;
}
