import { Request, Response } from 'express';
import userRepository, { onboardingQuestionRepository } from '@/api/users/users.service';
import paginationHandler from '@/utils/pagination.util';
import { In } from 'typeorm';

export default class UsersController {
    public async getUsersPage(req: Request, res: Response) {
        const builder = userRepository.createQueryBuilder('user');

        const total = await builder.getCount();
        const pagination = paginationHandler(req, total);
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
            .orderBy('user.createdAt', 'DESC');
        const users = await builder.getMany();

        res.render('users', {
            users: await Promise.all(
                users.map(async (user) => {
                    return {
                        ...user,
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
