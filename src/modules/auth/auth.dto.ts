import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn } from 'class-validator';

export class DemoLoginDto {
  @ApiProperty({ example: 'designer@demo.local' })
  @IsEmail()
  @IsIn([
    'designer@demo.local',
    'reviewer@demo.local',
    'requester@demo.local',
    'teamlead@demo.local',
  ])
  email!: string;
}
