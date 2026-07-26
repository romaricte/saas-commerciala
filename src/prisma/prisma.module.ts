import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // Rend le module disponible partout sans avoir à l'importer dans chaque module
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}