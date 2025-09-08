import {Request} from "express";

export type Pagination = {
    page: string;
    pageNumber: number;
    pagesCount: number;
    pageQuery: string;
    offset: number;
    limit: number;
}

type PaginationOptions = {
    limit?: number;
}

export default (req: Request, total: number, options?: PaginationOptions): Pagination => {

    const limit = options?.limit || 10;

    const pagination:Pagination  = {
        page: '',
        pageNumber: 1,
        pagesCount: 0,
        pageQuery: '',
        offset: 0,
        limit,
    };

    if (req.query.page) {
        if (isNaN(parseInt(String(req.query.page)))) {
            pagination.pageNumber = 1;
        } else {
            pagination.pageNumber = +req.query.page;
        }
    }

    pagination.offset = pagination.pageNumber * limit - limit;

    const splitUrl = req.originalUrl.split('?');
    if (splitUrl[1]) {
        splitUrl[1] = splitUrl[1].replace(/(&|)page=?\d+/gi, '');
        if (splitUrl[1]) {
            pagination.pageQuery = '?' + splitUrl[1];
        }
    }
    pagination.page = splitUrl[0];
    pagination.pagesCount = total > limit ? Math.ceil(total / limit) : 0;
    return pagination;
}
