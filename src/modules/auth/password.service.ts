import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

const ARGON2_OPTIONS: argon2.HashOptions & { raw: false } = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  hashLength: 32,
  raw: false,
};

@Injectable()
export class PasswordService {
  // Calculé une seule fois pour rapprocher le coût temporel d'un login inconnu
  // de celui d'un login existant et réduire l'énumération par timing.
  private readonly dummyHash = argon2.hash(
    'dummy-password-never-used',
    ARGON2_OPTIONS,
  );

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(passwordHash, password);
    } catch {
      // Un ancien format ou une valeur corrompue ne doit jamais produire une
      // erreur 500 ni révéler le format de stockage.
      return false;
    }
  }

  async verifyDummy(password: string): Promise<void> {
    await argon2.verify(await this.dummyHash, password);
  }
}
