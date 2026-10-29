import { ApiProperty } from '@nestjs/swagger';

export class PaginationMetaDto {
  @ApiProperty({ example: 1, description: 'Current page number' })
  page: number;

  @ApiProperty({ example: 15, description: 'Number of records per page' })
  limit: number;

  @ApiProperty({
    example: 45,
    description: 'Total number of records matching query',
  })
  total: number;

  @ApiProperty({ example: 3, description: 'Total number of available pages' })
  totalPages: number;

  @ApiProperty({
    example: true,
    description: 'Whether a subsequent page exists',
  })
  hasNextPage: boolean;

  @ApiProperty({
    example: false,
    description: 'Whether a preceding page exists',
  })
  hasPreviousPage: boolean;
}
