import { Router } from 'express';
import Controller from './users.controller';
import { sendPersonalMail } from './personal-mail';

const user: Router = Router();
const controller = new Controller();

user.get('/', controller.getUsersPage);
user.put('/', controller.editUser);
user.post('/:id/personal-mail', sendPersonalMail);

export default user;
