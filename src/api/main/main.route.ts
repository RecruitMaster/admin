import { Router } from 'express';
import Controller from './main.controller';

const router: Router = Router();
const controller = new Controller();

// init route
// router.post('/init', controller.init);
// router.post('/logs', controller.logs);

router.get('/', controller.renderMainPage);

export default router;
