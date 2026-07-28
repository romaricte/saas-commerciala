import { SetMetadata } from '@nestjs/common';

export const VERIFIED_EMAIL_KEY = 'verified-email-required';
export const RequireVerifiedEmail = () => SetMetadata(VERIFIED_EMAIL_KEY, true);
