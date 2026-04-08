import { IsString, IsOptional, IsBoolean, IsIn } from 'class-validator';

export class CreateReplyDto {
  @IsString()
  body: string;

  @IsOptional()
  @IsIn(['reply', 'note'])
  type?: string;

  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;
}
