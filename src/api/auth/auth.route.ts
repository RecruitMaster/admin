import { Router } from 'express';
import Controller from './auth.controller';

const router: Router = Router();
const controller = new Controller();

// init route
// router.post('/init', controller.init);
// router.post('/logs', controller.logs);

router.get('/login', controller.renderLoginPage);
router.post('/login', controller.login);
router.post('/logout', controller.logout);

export default router;
