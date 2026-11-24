import { Request, Response } from 'express';
import userRepository, { onboardingQuestionRepository } from '@/api/users/users.service';
import { applyUserSearch, parseUserSearch, userSearchPagination, USER_SEARCH_ROLES, UserSearch } from './user-search';
import { In } from 'typeorm';
import AppDataSource from '@/config/database';
import { randomBytes } from 'crypto';

export default class UsersController {
    public async getUsersPage(req: Request, res: Response) {
        let filters: UserSearch;
        try {
            filters = parseUserSearch(req.query);
        } catch {
            res.status(400).send('Проверьте параметры поиска: до 200 символов и 12 слов, роль — из списка.');
            return;
        }
        const builder = userRepository.createQueryBuilder('user');
        applyUserSearch(builder, filters);
        const total = await builder.getCount();
        const pagination = userSearchPagination(req, total, filters);
        builder
            .select([
                'user.id',
                'user.name',
                'user.surname',
                'user.status',
                'user.createdAt',
                'user.role',
                'user.email',
                'user.onboardingQuestions',
                'user.onboardingStep',
            ])
            .loadRelationCountAndMap('user.countCandidates', 'user.candidates')
            .offset(pagination.offset)
            .limit(pagination.limit)
            .orderBy('user.createdAt', 'DESC')
            .addOrderBy('user.id', 'DESC');
        const users = await builder.getMany();

        if (!req.session.personalMailToken) req.session.personalMailToken = randomBytes(32).toString('hex');
        const ids = users.filter((u) => u.role === 2).map((u) => u.id);
        const profiles = ids.length
            ? await AppDataSource.query(
                  `
            SELECT u.id, u.image, u.position_name, u.about, u.recruitment_specializations,
                u.hide_public_profile, c.name AS city, co.name_ru AS country,
                a.slug
            FROM "user" u
            LEFT JOIN cities c ON c.id = u.city_id
            LEFT JOIN countries co ON co.id = COALESCE(u.country_id, c.country_id)
            LEFT JOIN recruiter_profile_address a ON a.user_id = u.id AND a.is_current = true
            WHERE u.id = ANY($1::uuid[])`,
                  [ids],
              )
            : [];
        const profileMap = new Map(profiles.map((p) => [p.id, p]));
        res.render('users', {
            filters,
            searchRoles: USER_SEARCH_ROLES,
            total,
            personalMailToken: req.session.personalMailToken,
            users: await Promise.all(
                users.map(async (user) => {
                    return {
                        ...user,
                        recruiterProfile: profileMap.get(user.id),
                        onboardingQuestions: user.onboardingQuestions
                            ? await onboardingQuestionRepository.find({
                                  where: {
                                      id: In(user.onboardingQuestions),
                                  },
                              })
                            : [],
                    };
                }),
            ),
            pagination,
        });
    }

    public async editUser(req: Request, res: Response) {
        await userRepository.update(
            {
                id: req.body.id,
            },
            {
                status: req.body.status,
            },
        );
        res.json({
            message: 'ok',
        });
    }
}
