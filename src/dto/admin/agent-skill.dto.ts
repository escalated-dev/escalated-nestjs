import { IsInt, Min, Max } from 'class-validator';

export class AgentSkillEntryDto {
  @IsInt()
  userId: number;

  @IsInt()
  @Min(1)
  @Max(5)
  proficiency: number;
}
