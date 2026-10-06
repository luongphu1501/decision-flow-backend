import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { AuthUser } from '../../common/auth/auth-user';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  ArchiveWorkflowDto,
  CreateWorkflowDto,
  DiffVersionsQueryDto,
  DuplicateWorkflowDto,
  ListWorkflowsQueryDto,
  PublishWorkflowDto,
  SaveDraftDto,
  SimulateWorkflowDto,
} from './workflows.dto';
import { WorkflowsService } from './workflows.service';

@ApiTags('workflows')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly service: WorkflowsService) {}

  @Get()
  list(@Query() query: ListWorkflowsQueryDto, @CurrentUser() user: AuthUser) {
    return this.service.list(query, user);
  }

  @Post()
  @Roles(UserRole.DESIGNER)
  @ApiOperation({ summary: 'Create a workflow and revision-1 draft' })
  create(@Body() dto: CreateWorkflowDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.get(id, user);
  }

  @Get(':id/draft')
  @Roles(UserRole.DESIGNER)
  getDraft(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.getDraft(id, user);
  }

  @Patch(':id/draft')
  @Roles(UserRole.DESIGNER)
  saveDraft(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveDraftDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.saveDraft(id, dto, user);
  }

  @Post(':id/validate')
  @Roles(UserRole.DESIGNER)
  validate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.validate(id, user);
  }

  @Post(':id/simulate')
  @Roles(UserRole.DESIGNER)
  simulate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SimulateWorkflowDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.simulate(id, dto, user);
  }

  @Post(':id/publish')
  @Roles(UserRole.DESIGNER)
  publish(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PublishWorkflowDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.publish(id, dto, user);
  }

  @Get(':id/versions')
  versions(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.service.versions(id, user);
  }

  @Get(':id/versions/diff')
  diff(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DiffVersionsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.diff(id, query.base, query.target, user);
  }

  @Get(':id/versions/:versionId')
  version(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.version(id, versionId, user);
  }

  @Post(':id/duplicate')
  @Roles(UserRole.DESIGNER)
  duplicate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DuplicateWorkflowDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.duplicate(id, dto.name, user);
  }

  @Post(':id/archive')
  @Roles(UserRole.DESIGNER)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() _dto: ArchiveWorkflowDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.archive(id, user);
  }
}
