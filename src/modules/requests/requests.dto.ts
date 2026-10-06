import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ALLOWED_CATEGORIES, ALLOWED_DEPARTMENTS } from '../../domain/graph';

export class CreateRequestDto {
  @IsUUID()
  workflowId!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsIn(ALLOWED_DEPARTMENTS)
  department!: string;

  @IsIn(ALLOWED_CATEGORIES)
  category!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class DecisionDto {
  @IsIn(['APPROVED', 'REJECTED'])
  outcome!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason?: string;
}

export class ListRequestsQueryDto {
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
  @IsIn(['IN_PROGRESS', 'WAITING_REVIEW', 'APPROVED', 'REJECTED', 'FAILED'])
  status?: 'IN_PROGRESS' | 'WAITING_REVIEW' | 'APPROVED' | 'REJECTED' | 'FAILED';
}

export class InboxQueryDto extends ListRequestsQueryDto {
  @IsOptional()
  @IsIn(['pending', 'completed'])
  tab: 'pending' | 'completed' = 'pending';
}
