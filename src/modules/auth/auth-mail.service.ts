import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';

@Injectable()
export class AuthMailService {
  private readonly logger = new Logger(AuthMailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;
  private readonly frontendUrl: string;
  private readonly isProduction: boolean;

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    const user = config.get<string>('SMTP_USER');
    const pass = config.get<string>('SMTP_PASS');

    this.from = config.get<string>(
      'MAIL_FROM',
      'SaaS Commerciale <no-reply@example.com>',
    );
    this.frontendUrl = config.get<string>(
      'APP_FRONTEND_URL',
      'http://localhost:5173',
    );
    this.isProduction = config.get<string>('NODE_ENV') === 'production';

    this.transporter =
      host && user && pass
        ? nodemailer.createTransport({
            host,
            port: config.get<number>('SMTP_PORT', 587),
            secure: config.get<boolean>('SMTP_SECURE', false),
            auth: { user, pass },
          })
        : null;
  }

  async sendEmailVerification(
    email: string,
    firstName: string,
    token: string,
  ): Promise<void> {
    const url = `${this.frontendUrl}/verify-email?token=${encodeURIComponent(token)}`;
    await this.send({
      to: email,
      subject: 'Confirmez votre adresse e-mail',
      text: `Bonjour ${firstName}, confirmez votre adresse en ouvrant ce lien : ${url}`,
      html: `<p>Bonjour ${this.escapeHtml(firstName)},</p><p>Confirmez votre adresse e-mail :</p><p><a href="${url}">Vérifier mon adresse</a></p>`,
      developmentUrl: url,
    });
  }

  async sendPasswordReset(
    email: string,
    firstName: string,
    token: string,
  ): Promise<void> {
    const url = `${this.frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await this.send({
      to: email,
      subject: 'Réinitialisation de votre mot de passe',
      text: `Bonjour ${firstName}, choisissez un nouveau mot de passe : ${url}`,
      html: `<p>Bonjour ${this.escapeHtml(firstName)},</p><p>Une réinitialisation de mot de passe a été demandée :</p><p><a href="${url}">Choisir un nouveau mot de passe</a></p><p>Ignorez cet e-mail si vous n’êtes pas à l’origine de la demande.</p>`,
      developmentUrl: url,
    });
  }

  async sendUserInvitation(input: {
    email: string;
    firstName: string;
    tenantName: string;
    inviterName: string;
    token: string;
  }): Promise<void> {
    const url = `${this.frontendUrl}/accept-invitation?token=${encodeURIComponent(input.token)}`;
    await this.send({
      to: input.email,
      subject: `Invitation à rejoindre ${input.tenantName}`,
      text: `Bonjour ${input.firstName}, ${input.inviterName} vous invite à rejoindre ${input.tenantName}. Choisissez votre mot de passe : ${url}`,
      html: `<p>Bonjour ${this.escapeHtml(input.firstName)},</p><p>${this.escapeHtml(input.inviterName)} vous invite à rejoindre ${this.escapeHtml(input.tenantName)}.</p><p><a href="${url}">Accepter l’invitation</a></p>`,
      developmentUrl: url,
    });
  }

  private async send(input: {
    to: string;
    subject: string;
    text: string;
    html: string;
    developmentUrl: string;
  }): Promise<void> {
    if (!this.transporter) {
      if (this.isProduction) {
        this.logger.error(
          `E-mail "${input.subject}" non envoyé : SMTP n'est pas configuré`,
        );
      } else {
        this.logger.debug(
          `[DEV ONLY] ${input.subject} pour ${input.to}: ${input.developmentUrl}`,
        );
      }
      return;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
    } catch (error) {
      // Le compte ou le jeton existent déjà en base. Une panne SMTP ne doit pas
      // annuler la transaction ; l'utilisateur peut demander un nouvel envoi.
      this.logger.error(
        `Échec d'envoi de "${input.subject}" à ${input.to}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private escapeHtml(value: string): string {
    return value.replace(
      /[&<>"']/g,
      (character) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#039;',
        })[character] ?? character,
    );
  }
}
