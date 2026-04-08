import { IsString, IsOptional, IsInt, IsIn, IsArray, MaxLength, IsDateString } from 'class-validator';

export class UpdateTicketDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  subject?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'urgent'])
  priority?: string;

  @IsOptional()
  @IsInt()
  departmentId?: number;

  @IsOptional()
  @IsInt()
  assigneeId?: number;

  @IsOptional()
  @IsInt()
  statusId?: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  tagIds?: number[];

  @IsOptional()
  customFields?: Record<string, any>;

  @IsOptional()
  @IsDateString()
  snoozedUntil?: string;
}
