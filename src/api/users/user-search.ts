import type { Request } from 'express';
import type { Pagination } from '../../utils/pagination.util';

export const USER_SEARCH_ROLES = [
    { value: '2', label: 'Рекрутеры' },
    { value: '4', label: 'Кандидаты' },
    { value: '1', label: 'Компании' },
    { value: '3', label: 'Заказчики' },
    { value: '7', label: 'Разработчики' },
    { value: '8', label: 'Администраторы' },
];

export type UserSearch = { search: string; role: string };

export function parseUserSearch(query: Request['query']): UserSearch {
    if (query.search !== undefined && typeof query.search !== 'string') throw new Error('Invalid search');
    if (query.role !== undefined && typeof query.role !== 'string') throw new Error('Invalid role');
    const search = ((query.search as string | undefined) ?? '').trim().replace(/\s+/gu, ' ');
    const role = (query.role as string | undefined) ?? '';
    if (search.length > 200 || search.split(' ').length > 12) throw new Error('Search too long');
    if (role && !USER_SEARCH_ROLES.some((item) => item.value === role)) throw new Error('Unknown role');
    return { search, role };
}

export function applyUserSearch<T extends { andWhere: (sql: string, parameters: Record<string, unknown>) => unknown }>(
    builder: T,
    filters: UserSearch,
): T {
    if (filters.role) builder.andWhere('user.role = :userSearchRole', { userSearchRole: Number(filters.role) });
    const fields = ['user.name', 'user.surname', 'user.email', 'user.companyName', 'CAST(user.id AS text)'];
    // Every word must match somewhere, so either order of first/last name works.
    for (const [index, word] of (filters.search ? filters.search.split(' ') : []).entries()) {
        const key = 'userSearchWord' + index;
        const escaped = word.replace(/[\\%_]/g, (value) => '\\' + value);
        builder.andWhere('(' + fields.map((field) => `${field} ILIKE :${key} ESCAPE '\\'`).join(' OR ') + ')', {
            [key]: '%' + escaped + '%',
        });
    }
    return builder;
}

export function userSearchPagination(req: Request, total: number, filters: UserSearch): Pagination {
    const limit = 10;
    const requested =
        typeof req.query.page === 'string' && /^[1-9]\d{0,6}$/.test(req.query.page) ? Number(req.query.page) : 1;
    const pageNumber = Math.min(requested, Math.max(1, Math.ceil(total / limit)));
    const params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.role) params.set('role', filters.role);
    const queryString = params.toString();
    return {
        page: '/users',
        pageNumber,
        pagesCount: total > limit ? Math.ceil(total / limit) : 0,
        pageQuery: queryString ? '?' + queryString : '',
        offset: (pageNumber - 1) * limit,
        limit,
    };
}
