process.env.DATABASE_URL =
  'postgresql://test:test@localhost:5432/saas_commerciale_test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-'.repeat(4);
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-'.repeat(4);
process.env.AUTH_TOKEN_PEPPER = 'test-token-pepper-'.repeat(4);
