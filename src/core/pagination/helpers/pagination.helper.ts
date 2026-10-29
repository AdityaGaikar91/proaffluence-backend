import { PaginationQueryDto } from '../dto/pagination-query.dto';
import { PaginationMetaDto } from '../dto/pagination-meta.dto';

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
  take: number;
  sortBy?: string;
  sortOrder: 'asc' | 'desc';
}

/**
 * Normalizes pagination query parameters with safe bounds and defaults.
 * Default page: 1
 * Default limit: 15 (Max: 100)
 */
export function parsePaginationParams(
  query: PaginationQueryDto,
  defaultSortBy = 'createdAt',
): PaginationParams {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 10));
  const skip = (page - 1) * limit;
  const sortBy = query.sortBy || defaultSortBy;
  const sortOrder = query.sortOrder || 'asc';

  return {
    page,
    limit,
    skip,
    take: limit,
    sortBy,
    sortOrder,
  };
}

/**
 * Computes standard pagination metadata including totalPages and next/prev page flags.
 */
export function createPaginationMeta(
  total: number,
  page: number,
  limit: number,
): PaginationMetaDto {
  const safeLimit = Math.max(1, limit);
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  const safePage = Math.max(1, page);

  return {
    page: safePage,
    limit: safeLimit,
    total,
    totalPages,
    hasNextPage: safePage < totalPages,
    hasPreviousPage: safePage > 1,
  };
}
