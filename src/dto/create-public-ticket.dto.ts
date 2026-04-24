import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Payload shape for unauthenticated public ticket submission via the widget
 * or host-app public form. Distinct from CreateTicketDto (which requires a
 * resolved numeric requesterId + supports admin-only fields).
 */
export class CreatePublicTicketDto {
  @IsEmail()
  @MaxLength(320)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  subject: string;

  @IsString()
  @MinLength(1)
  description: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'urgent'])
  priority?: 'low' | 'medium' | 'high' | 'urgent';
}
