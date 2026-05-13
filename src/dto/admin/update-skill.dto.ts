import {
  IsString,
  IsOptional,
  IsArray,
  IsInt,
  MaxLength,
  ArrayUnique,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AgentSkillEntryDto } from './agent-skill.dto';

export class UpdateSkillDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  routingTagIds?: number[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  routingDepartmentIds?: number[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentSkillEntryDto)
  agents?: AgentSkillEntryDto[];
}
