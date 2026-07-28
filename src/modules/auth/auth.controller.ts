import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { Public } from '@common/decorators/public.decorator';
import type { RequestWithUser } from '@common/auth/request-with-user.interface';
import { AuthService } from './auth.service';
import { AuthResponse, AuthResult, RequestMetadata } from './auth.types';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  VerifyEmailDto,
} from './dto/auth.dto';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly refreshCookieName: string;
  private readonly secureCookie: boolean;

  constructor(
    private readonly authService: AuthService,
    config: ConfigService,
  ) {
    this.refreshCookieName = config.get<string>(
      'REFRESH_COOKIE_NAME',
      'refresh_token',
    );
    this.secureCookie =
      config.get<boolean>('COOKIE_SECURE', false) ||
      config.get<string>('NODE_ENV') === 'production';
  }

  @Post('register')
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Créer une entreprise et son administrateur' })
  @ApiResponse({ status: 201, description: 'Compte et session créés' })
  async register(
    @Body() dto: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    return this.respondWithSession(
      await this.authService.register(dto, this.metadata(request)),
      response,
    );
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Ouvrir une session' })
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    return this.respondWithSession(
      await this.authService.login(dto, this.metadata(request)),
      response,
    );
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('refresh_token')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Faire tourner le refresh token' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponse> {
    const token = this.readRefreshToken(request);
    return this.respondWithSession(
      await this.authService.refresh(token),
      response,
    );
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Fermer la session courante' })
  async logout(
    @CurrentUser('id') userId: string,
    @CurrentUser('sessionId') sessionId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(userId, sessionId);
    this.clearRefreshCookie(response);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Fermer toutes les sessions du compte' })
  async logoutAll(
    @CurrentUser('id') userId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logoutAll(userId);
    this.clearRefreshCookie(response);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lire le profil authentifié' })
  me(@CurrentUser('id') userId: string) {
    return this.authService.me(userId);
  }

  @Patch('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Changer le mot de passe et révoquer toutes les sessions',
  })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.changePassword(userId, dto);
    this.clearRefreshCookie(response);
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Demander un lien de réinitialisation sans révéler le compte',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto.email);
    return {
      message:
        'Si ce compte existe, un e-mail de réinitialisation a été envoyé',
    };
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Réinitialiser le mot de passe avec un jeton' })
  resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.authService.resetPassword(dto);
  }

  @Post('verify-email')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Valider une adresse e-mail' })
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<void> {
    return this.authService.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Renvoyer un lien de validation' })
  async resendVerification(@Body() dto: ResendVerificationDto) {
    await this.authService.resendVerification(dto.email);
    return {
      message: 'Si le compte doit être vérifié, un nouvel e-mail a été envoyé',
    };
  }

  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Lister les appareils connectés' })
  sessions(@Req() request: RequestWithUser) {
    return this.authService.listSessions(
      request.user.id,
      request.user.sessionId,
    );
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Révoquer un appareil connecté' })
  async revokeSession(
    @CurrentUser('id') userId: string,
    @Param('sessionId') sessionId: string,
    @CurrentUser('sessionId') currentSessionId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.revokeSession(userId, sessionId);
    if (sessionId === currentSessionId) {
      this.clearRefreshCookie(response);
    }
  }

  private respondWithSession(
    result: AuthResult,
    response: Response,
  ): AuthResponse {
    response.cookie(this.refreshCookieName, result.refreshToken, {
      httpOnly: true,
      secure: this.secureCookie,
      sameSite: 'strict',
      path: '/api/v1/auth',
      expires: result.refreshTokenExpiresAt,
    });
    return result.response;
  }

  private clearRefreshCookie(response: Response): void {
    response.clearCookie(this.refreshCookieName, {
      httpOnly: true,
      secure: this.secureCookie,
      sameSite: 'strict',
      path: '/api/v1/auth',
    });
  }

  private readRefreshToken(request: Request): string {
    const cookieToken = (
      request as unknown as {
        cookies?: Record<string, string | undefined>;
      }
    ).cookies?.[this.refreshCookieName];
    if (!cookieToken) {
      throw new UnauthorizedException('Refresh token manquant');
    }
    return cookieToken;
  }

  private metadata(request: Request): RequestMetadata {
    return {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    };
  }
}
