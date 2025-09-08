import { Request, Response } from 'express';
import userRepository from "@/api/users/users.service";
import paginationHandler from "@/utils/pagination.util";
import {ticketMessageRepository, ticketRepository} from "@/api/help/help.service";
import {Uuid} from "@/common/types/common.type";

export default class HelpController {
    public async getAllTicketsPage(req: Request, res: Response) {

        const builder = ticketRepository.createQueryBuilder('ticket');

        const total = await builder.getCount();
        const pagination = paginationHandler(req, total);
        builder
            .loadRelationCountAndMap('ticket.messagesCount', 'ticket.messages')
            .offset(pagination.offset)
            .limit(pagination.limit)
            .orderBy('ticket.createdAt', 'DESC');
        const tickets = await builder.getMany();

        res.render('tickets', {tickets, pagination});
    }

    public async getTicketPage(req: Request, res: Response) {
        const ticket = await ticketRepository.findOne({
            where: {
                id: req.params.id as Uuid,
            },
            relations: ['messages'],
        });
        return res.render('ticket', {ticket});
    }

    public async addMessageToTicket(req: Request, res: Response) {
        await ticketMessageRepository.save({
            ticketId: req.body.ticketId,
            userId: req.session.user!.id,
            text: req.body.text,
        });
        res.json({
            message: 'ok',
        })
    }

}


