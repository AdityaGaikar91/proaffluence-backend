import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ description: 'Service health status', example: 'ok' })
  status: string;

  @ApiProperty({ description: 'Timestamp of the health check', example: '2026-10-22T08:00:00.000Z' })
  timestamp: string;
}
