import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthMailService } from './auth-mail.service';
import { AuthService } from './auth.service';
import { AuthTokenService } from './auth-token.service';
import { PasswordService } from './password.service';

@Module({
  imports: [JwtModule.register({})],
  providers: [AuthService, AuthTokenService, PasswordService, AuthMailService],
  controllers: [AuthController],
  exports: [AuthTokenService, PasswordService, AuthMailService],
})
export class AuthModule {}
