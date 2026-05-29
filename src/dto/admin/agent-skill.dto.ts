import { IsInt, Min, Max } from 'class-validator';
import { UserId } from '../../config/user-id-column';

export class AgentSkillEntryDto {
  userId: UserId;

  @IsInt()
  @Min(1)
  @Max(5)
  proficiency: number;
}
