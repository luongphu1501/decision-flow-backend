import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../../common/auth/auth-user';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ActivityQueryDto } from './activity.dto';
import { ActivityService } from './activity.service';

@ApiTags('activity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('activity')
export class ActivityController {
  constructor(private readonly service: ActivityService) {}

  @Get()
  list(@Query() query: ActivityQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.list(query, user);
  }
}
