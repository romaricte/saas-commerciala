import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),

  DATABASE_URL: Joi.string().required(),

  // JWT_SECRET reste accepté en développement pour compatibilité. En production,
  // les secrets access/refresh séparés sont obligatoires.
  JWT_SECRET: Joi.string()
    .min(16)
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.string().min(32).required(),
      otherwise: Joi.string().min(16).optional(),
    }),
  JWT_ACCESS_SECRET: Joi.string().min(32).when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  JWT_REFRESH_SECRET: Joi.string().min(32).when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  AUTH_TOKEN_PEPPER: Joi.string().min(32).when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  JWT_ACCESS_TTL_SECONDS: Joi.number().integer().min(60).default(900),
  JWT_REFRESH_TTL_SECONDS: Joi.number().integer().min(3600).default(2_592_000),
  EMAIL_VERIFICATION_TTL_SECONDS: Joi.number()
    .integer()
    .min(300)
    .default(86_400),
  PASSWORD_RESET_TTL_SECONDS: Joi.number().integer().min(300).default(1_800),
  INVITATION_TTL_SECONDS: Joi.number().integer().min(3_600).default(604_800),

  AUTH_MAX_LOGIN_ATTEMPTS: Joi.number().integer().min(3).default(5),
  AUTH_LOCKOUT_SECONDS: Joi.number().integer().min(60).default(900),
  REFRESH_COOKIE_NAME: Joi.string().default('refresh_token'),
  COOKIE_SECURE: Joi.boolean().default(false),
  CORS_ORIGINS: Joi.string().default('http://localhost:5173'),
  APP_FRONTEND_URL: Joi.string().uri().default('http://localhost:5173'),
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).default(0),

  SMTP_HOST: Joi.string().allow('').optional(),
  SMTP_PORT: Joi.number().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().allow('').optional(),
  SMTP_PASS: Joi.string().allow('').optional(),
  MAIL_FROM: Joi.string().default('SaaS Commerciale <no-reply@example.com>'),
})
  .or('JWT_SECRET', 'JWT_ACCESS_SECRET')
  .messages({
    'object.missing':
      'JWT_SECRET ou JWT_ACCESS_SECRET doit être défini pour signer les access tokens',
  });
