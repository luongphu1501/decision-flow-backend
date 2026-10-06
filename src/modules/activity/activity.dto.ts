import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ActivityQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsIn(['WORKFLOW', 'REQUEST'])
  entityType?: 'WORKFLOW' | 'REQUEST';

  @IsOptional()
  @IsIn([
    'WORKFLOW_CREATED',
    'WORKFLOW_DUPLICATED',
    'WORKFLOW_ARCHIVED',
    'DRAFT_UPDATED',
    'DRAFT_REVISION_CONFLICT',
    'VALIDATION_REQUESTED',
    'SIMULATION_EXECUTED',
    'WORKFLOW_PUBLISHED',
    'REQUEST_SUBMITTED',
    'REQUEST_ROUTED',
    'REVIEW_DECIDED',
    'REQUEST_COMPLETED',
  ])
  action?: string;
}
