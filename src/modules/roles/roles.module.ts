import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';
import { UsersModule } from '@modules/users/users.module';
import { PermissionsController } from './permissions.controller';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [RolesController, PermissionsController],
  providers: [RolesService],
})
export class RolesModule {}
