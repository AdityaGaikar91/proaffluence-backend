import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { HealthResponseDto } from './dto/health-response.dto';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @ApiOperation({
    summary: 'Service health check',
    description: 'Public health probe endpoint for monitoring and uptime checks',
  })
  @ApiResponse({
    status: 200,
    description: 'Service is operational',
    type: HealthResponseDto,
  })
  check(): HealthResponseDto {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
