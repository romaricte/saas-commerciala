import { Module } from '@nestjs/common';
import { UsersModule } from '@modules/users/users.module';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';

@Module({
  imports: [UsersModule],
  controllers: [QuotesController],
  providers: [QuotesService],
})
export class QuotesModule {}
