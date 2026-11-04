import { Controller, Get, UnauthorizedException } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from './decorators/current-user.decorator';
import { MeResponseDto } from './dto/me-response.dto';

@ApiTags('Auth')
@ApiCookieAuth('proaffluence.session_token')
@Controller('api/auth')
export class MeController {
  @Get('me')
  @ApiOperation({
    summary: 'Get current user profile',
    description:
      'Returns profile details and internal role for the authenticated session user',
  })
  @ApiResponse({
    status: 200,
    description: 'Current session user profile',
    type: MeResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - invalid or missing session cookie',
  })
  getMe(@CurrentUser() user: any): MeResponseDto {
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role ?? 'staff_entry',
    };
  }
}
