import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiCookieAuth,
} from '@nestjs/swagger';
import { GroupHeadsService } from './group-heads.service';
import { CreateGroupHeadDto } from './dto/create-group-head.dto';
import { UpdateGroupHeadDto } from './dto/update-group-head.dto';
import { CreateFamilyMemberDto } from './dto/create-family-member.dto';
import { QueryGroupHeadDto } from './dto/query-group-head.dto';
import { ToggleStatusDto } from './dto/toggle-status.dto';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Group Heads')
@ApiCookieAuth('proaffluence.session_token')
@UseGuards(RolesGuard)
@Controller('api/v1/group-heads')
export class GroupHeadsController {
  constructor(private readonly groupHeadsService: GroupHeadsService) {}

  @Get('categories')
  @ApiOperation({
    summary: 'List supported categories and sub-categories dictionary',
  })
  @ApiResponse({ status: 200, description: 'Returns category master enums.' })
  getCategories() {
    return this.groupHeadsService.getCategories();
  }

  @Get()
  @ApiOperation({
    summary:
      'List client group heads with search, filters, and summary metrics',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns list of group heads and pagination meta.',
  })
  async findAll(@Query() query: QueryGroupHeadDto) {
    return this.groupHeadsService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get single group head mandate by ID or customId' })
  @ApiResponse({
    status: 200,
    description: 'Returns mandate profile and family list.',
  })
  @ApiResponse({ status: 404, description: 'Group head not found.' })
  async findOne(@Param('id') id: string) {
    return this.groupHeadsService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('super_admin', 'manager')
  @ApiOperation({
    summary: 'Register a new Group Head mandate (Manager & Super Admin only)',
  })
  @ApiResponse({ status: 201, description: 'Group Head created successfully.' })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 403, description: 'Forbidden for staff_entry.' })
  @ApiResponse({ status: 409, description: 'Name or Custom ID collision.' })
  async create(
    @Body() dto: CreateGroupHeadDto,
    @CurrentUser() user: { id: string; name?: string },
  ) {
    return this.groupHeadsService.create(dto, user);
  }

  @Patch(':id')
  @Roles('super_admin', 'manager')
  @ApiOperation({
    summary: 'Update Group Head mandate details (Manager & Super Admin only)',
  })
  @ApiResponse({ status: 200, description: 'Group Head updated successfully.' })
  @ApiResponse({ status: 400, description: 'Validation error.' })
  @ApiResponse({ status: 403, description: 'Forbidden for staff_entry.' })
  @ApiResponse({ status: 404, description: 'Group head not found.' })
  @ApiResponse({ status: 409, description: 'Name or Custom ID collision.' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateGroupHeadDto,
    @CurrentUser() user: { id: string; name?: string },
  ) {
    return this.groupHeadsService.update(id, dto, user);
  }

  @Patch(':id/status')
  @Roles('super_admin', 'manager')
  @ApiOperation({
    summary:
      'Toggle mandate Active/Inactive operational status (Manager & Super Admin only)',
  })
  @ApiResponse({ status: 200, description: 'Status updated.' })
  @ApiResponse({ status: 403, description: 'Forbidden for staff_entry.' })
  @ApiResponse({ status: 404, description: 'Group head not found.' })
  async toggleStatus(
    @Param('id') id: string,
    @Body() dto: ToggleStatusDto,
    @CurrentUser() user: { id: string; name?: string },
  ) {
    return this.groupHeadsService.toggleStatus(id, dto.status, user);
  }

  @Delete(':id')
  @Roles('super_admin', 'manager')
  @ApiOperation({
    summary:
      'Delete mandate if no cashflows or closing balances exist (Manager & Super Admin only)',
  })
  @ApiResponse({ status: 200, description: 'Mandate deleted successfully.' })
  @ApiResponse({
    status: 400,
    description: 'Blocked: active transactions exist.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden for staff_entry.' })
  @ApiResponse({ status: 404, description: 'Group head not found.' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: { id: string; name?: string },
  ) {
    return this.groupHeadsService.remove(id, user);
  }

  @Post(':id/family-members')
  @HttpCode(HttpStatus.CREATED)
  @Roles('super_admin', 'manager')
  @ApiOperation({
    summary:
      'Add family member / beneficiary under Group Head (Manager & Super Admin only)',
  })
  @ApiResponse({ status: 201, description: 'Family member added.' })
  @ApiResponse({ status: 403, description: 'Forbidden for staff_entry.' })
  @ApiResponse({ status: 404, description: 'Group head not found.' })
  @ApiResponse({ status: 409, description: 'Duplicate member name.' })
  async addFamilyMember(
    @Param('id') id: string,
    @Body() dto: CreateFamilyMemberDto,
    @CurrentUser() user: { id: string; name?: string },
  ) {
    return this.groupHeadsService.addFamilyMember(id, dto, user);
  }

  @Delete(':id/family-members/:memberId')
  @Roles('super_admin', 'manager')
  @ApiOperation({
    summary:
      'Remove family member from Group Head (Manager & Super Admin only)',
  })
  @ApiResponse({ status: 200, description: 'Family member removed.' })
  @ApiResponse({
    status: 400,
    description:
      'Cannot remove last family member or member linked to cashflows.',
  })
  @ApiResponse({ status: 403, description: 'Forbidden for staff_entry.' })
  @ApiResponse({ status: 404, description: 'Member not found.' })
  async removeFamilyMember(
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: { id: string; name?: string },
  ) {
    return this.groupHeadsService.removeFamilyMember(id, memberId, user);
  }
}
