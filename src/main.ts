import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  app.use(isProduction ? helmet() : helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  const trustProxyHops = config.get<number>('TRUST_PROXY_HOPS', 0);
  if (trustProxyHops > 0) {
    const expressInstance = app.getHttpAdapter().getInstance() as {
      set(name: string, value: number): void;
    };
    expressInstance.set('trust proxy', trustProxyHops);
  }
  app.enableCors({
    origin: config
      .get<string>('CORS_ORIGINS', 'http://localhost:5173')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('API SaaS Gestion Commerciale')
      .setDescription('API multi-tenant de gestion commerciale pour PME')
      .setVersion('1.0')
      .addBearerAuth()
      .addCookieAuth('refresh_token')
      .build();
    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
    );
  }

  await app.listen(config.get<number>('PORT', 3000));
}

void bootstrap();
