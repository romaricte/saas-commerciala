import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';

describe('AuthController', () => {
  const authService = {};
  const response = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  };

  let controller: AuthController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuthController(
      authService as never,
      new ConfigService({
        REFRESH_COOKIE_NAME: 'refresh_token',
        COOKIE_SECURE: false,
        NODE_ENV: 'test',
      }),
    );
  });

  it('refuse un refresh sans cookie HttpOnly', async () => {
    await expect(
      controller.refresh({ cookies: {} } as never, response as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
