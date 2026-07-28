import { SetMetadata } from '@nestjs/common';
import { PermissionKey } from '../auth/permission.constants';

export const PERMISSIONS_KEY = 'required-permissions';
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
