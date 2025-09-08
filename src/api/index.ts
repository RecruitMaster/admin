import { Router } from 'express';
import auth from './auth/auth.route';
import users from './users/users.route';
import main from './main/main.route';
import help from './help/help.route';
import { checkSessionAndSetUser } from '@/api/auth/auth.middleware';

const router: Router = Router();

router.get('/', (req, res) => {
    if (req.session.user) {
        res.redirect('/main');
    } else {
        res.redirect('/auth/login');
    }
});

router.use('/auth', auth);
router.use('/main', checkSessionAndSetUser, main);
router.use('/help', checkSessionAndSetUser, help);
router.use('/users', checkSessionAndSetUser, users);

export default router;
