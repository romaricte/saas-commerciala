import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '@common/decorators/public.decorator';
import { AcceptInvitationDto } from './dto/users.dto';
import { UsersService } from './users.service';

@ApiTags('Invitations')
@Controller('invitations')
@Public()
export class InvitationsController {
  constructor(private readonly usersService: UsersService) {}

  @Post('accept')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Accepter une invitation et choisir son mot de passe',
  })
  accept(@Body() dto: AcceptInvitationDto) {
    return this.usersService.acceptInvitation(dto);
  }
}
