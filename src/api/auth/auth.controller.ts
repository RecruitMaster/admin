import { Request, Response } from 'express';
import userRepository from '@/api/users/users.service';
import { USER_ROLES, USER_STATUSES } from '@/api/users/types/user.constants';
import { verifyPassword } from '@/utils/password.util';

export default class AuthController {
    public login = async (req: Request, res: Response) => {
        const user = await userRepository.findOne({
            where: {
                email: req.body.email.toLowerCase(),
            },
        });

        const roles = [USER_ROLES.DEV, USER_ROLES.ADMIN];

        if (!user || user.status !== USER_STATUSES.ACTIVE || !roles.includes(user.role)) {
            return res.send({
                message: 'forbidden',
            });
        }

        const isPasswordValid = user && (await verifyPassword(req.body.password, user.password));

        if (!isPasswordValid) {
            return res.send({
                message: 'credentials',
            });
        }

        req.session.user = {
            id: user.id,
            name: user.name,
            surname: user.surname,
        };

        return res.json({
            message: 'ok',
        });
    };

    renderLoginPage = async (req: Request, res: Response) => {
        if (req.session.user) {
            return res.redirect('/main');
        }
        res.render('login');
    };

    public logout = async (req: Request, res: Response) => {
        req.session.destroy((err) => {
            if (err) {
                return res.status(200).json({
                    message: 'error',
                });
            }
            return res.status(200).json({
                message: 'ok',
            });
        });
    };
}
