import { Router } from 'express';
import Controller from './help.controller';

const user: Router = Router();
const controller = new Controller();

user.get('/', controller.getAllTicketsPage);
user.get('/:id', controller.getTicketPage);
user.post('/message', controller.addMessageToTicket);

export default user;
