import { Router } from 'express';
import Controller from './users.controller';

const user: Router = Router();
const controller = new Controller();

user.get('/', controller.getUsersPage);
user.put('/', controller.editUser);

export default user;
