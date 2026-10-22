import {
  IsString,
  IsOptional,
  IsInt,
  IsIn,
  IsArray,
  MaxLength,
  IsDateString,
  IsObject,
} from 'class-validator';
import { UserId } from '../config/user-id-column';

export class UpdateTicketDto {
  @IsOptional()
  @IsIn(['question', 'problem', 'incident', 'task'])
  ticketType?: string;

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
  assigneeId?: UserId;

  @IsOptional()
  @IsInt()
  statusId?: number;

  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  tagIds?: number[];

  /** Older form of `custom_fields`, keyed by field id. */
  @IsOptional()
  customFields?: Record<string, any>;

  /** Custom field values keyed by field slug (escalated-laravel's `custom_fields`). */
  @IsOptional()
  @IsObject()
  custom_fields?: Record<string, any>;

  @IsOptional()
  @IsDateString()
  snoozedUntil?: string;
}
