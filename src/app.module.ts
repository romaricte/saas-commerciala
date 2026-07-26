import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { ConfigModule } from '@nestjs/config';
import { envValidationSchema } from '@config/env.validation';
import { PrismaModule } from '@prisma/prisma.module';

@Module({
  imports: [ 
    ConfigModule.forRoot({
      isGlobal: true, // Rend ConfigService injectable partout sans réimporter
      envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
      validationSchema: envValidationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
    PrismaModule, // Ajout du module Prisma
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
