import { IsString, IsOptional, IsInt, IsIn, IsArray, IsObject, MaxLength } from 'class-validator';
import { UserId } from '../config/user-id-column';

export class CreateTicketDto {
  @IsOptional()
  @IsIn(['question', 'problem', 'incident', 'task'])
  ticketType?: string;

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
  assigneeId?: UserId;

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

  /** Flat map of host parameters, e.g. from an embedded widget. */
  @IsOptional()
  @IsObject()
  metadata?: Record<string, string | number | boolean> | null;
}
