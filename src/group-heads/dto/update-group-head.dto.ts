import { PartialType } from '@nestjs/swagger';
import { CreateGroupHeadDto } from './create-group-head.dto';

export class UpdateGroupHeadDto extends PartialType(CreateGroupHeadDto) {}
