import { IsString, IsOptional, IsInt, IsIn, IsArray, MaxLength } from 'class-validator';

export class CreateTicketDto {
  @IsString()
  @MaxLength(500)
  subject: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'urgent'])
  priority?: string;

  @IsOptional()
  @IsIn(['web', 'email', 'api', 'widget'])
  channel?: string;

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
  @IsInt()
  contactId?: number | null;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  tagIds?: number[];

  @IsOptional()
  customFields?: Record<string, any>;
}
