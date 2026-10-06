import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../../common/auth/auth-user';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateRequestDto, DecisionDto, InboxQueryDto, ListRequestsQueryDto } from './requests.dto';
import { RequestsService } from './requests.service';

@ApiTags('requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('requests')
export class RequestsController {
  constructor(private readonly service: RequestsService) {}

  @Get()
  list(@Query() query: ListRequestsQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.list(query, user);
  }

  @Post()
  @Roles(UserRole.REQUESTER, UserRole.DESIGNER, UserRole.REVIEWER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'UUID generated once per submit attempt',
  })
  create(
    @Body() dto: CreateRequestDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.create(dto, idempotencyKey, user);
  }

  @Get('inbox')
  @Roles(UserRole.REVIEWER)
  inbox(@Query() query: InboxQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.inbox(query, user);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.get(id, user);
  }

  @Post(':id/decision')
  @Roles(UserRole.REVIEWER)
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DecisionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.decide(id, dto, user);
  }
}
