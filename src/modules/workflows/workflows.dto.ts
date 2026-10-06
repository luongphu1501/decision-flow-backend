import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class PositionDto {
  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;
}

export class WorkflowNodeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  id!: string;

  @IsIn(['start', 'condition', 'review', 'approve', 'reject'])
  type!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ValidateNested()
  @Type(() => PositionDto)
  position!: PositionDto;

  @IsObject()
  config!: Record<string, unknown>;
}

export class WorkflowEdgeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  id!: string;

  @IsString()
  sourceNodeId!: string;

  @IsString()
  targetNodeId!: string;

  @IsOptional()
  @IsString()
  sourceHandle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @IsOptional()
  @IsIn(['true', 'false', 'approved', 'rejected', 'default'])
  branch?: string;
}

export class CreateWorkflowDto {
  @ApiProperty({ example: 'Expense Approval' })
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class SaveDraftDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  baseRevision!: number;

  @ApiProperty({ example: 18 })
  @IsInt()
  @Min(0)
  clientSequence!: number;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => WorkflowNodeDto)
  nodes!: WorkflowNodeDto[];

  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => WorkflowEdgeDto)
  edges!: WorkflowEdgeDto[];

  @IsOptional()
  @IsObject()
  viewport?: Record<string, unknown>;
}

export class SimulationInputDto {
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  department!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  category!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  requesterId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class SimulateWorkflowDto extends SimulationInputDto {
  @IsOptional()
  @IsObject()
  fixtureDecisions?: Record<string, 'approved' | 'rejected'>;
}

export class PublishWorkflowDto {
  @IsInt()
  @Min(1)
  expectedRevision!: number;

  @IsOptional()
  @IsObject()
  changeSummary?: Record<string, unknown>;
}

export class ListWorkflowsQueryDto {
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
  @IsIn(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

  @IsOptional()
  @IsString()
  @MaxLength(80)
  search?: string;

  @IsOptional()
  @IsIn(['updatedAt', 'createdAt', 'name'])
  sort = 'updatedAt';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  direction: 'asc' | 'desc' = 'desc';
}

export class DiffVersionsQueryDto {
  @IsUUID()
  base!: string;

  @IsUUID()
  target!: string;
}

export class DuplicateWorkflowDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  name?: string;
}

export class ArchiveWorkflowDto {
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}
