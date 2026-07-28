import { UserRole } from '@prisma/client';

export interface RequestMetadata {
  ipAddress?: string;
  userAgent?: string;
}

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  tenantId: string | null;
  emailVerified: boolean;
}

export interface AuthResponse {
  accessToken: string;
  accessTokenExpiresIn: number;
  user: PublicUser;
}

export interface AuthResult {
  response: AuthResponse;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export interface SessionResponse {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  current: boolean;
}
