import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { InvitationsController } from './invitations.controller';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule],
  controllers: [UsersController, InvitationsController, AuditController],
  providers: [UsersService, AuditService],
  exports: [AuditService],
})
export class UsersModule {}
