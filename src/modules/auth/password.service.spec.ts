import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hache avec Argon2id et vérifie sans exposer le mot de passe', async () => {
    const hash = await service.hash('UnePhrase!Solide42');

    expect(hash).toMatch(/^\$argon2id\$/);
    await expect(service.verify(hash, 'UnePhrase!Solide42')).resolves.toBe(
      true,
    );
    await expect(service.verify(hash, 'Mauvais!123456')).resolves.toBe(false);
  });

  it('traite un ancien hash illisible comme un mot de passe invalide', async () => {
    await expect(
      service.verify('legacy-or-corrupted-hash', 'Secret!123456'),
    ).resolves.toBe(false);
  });
});
