import AppDataSource from '@/config/database';
import {TicketEntity} from "@/api/help/entities/ticket.entity";
import {TicketMessageEntity} from "@/api/help/entities/ticket-message.entity";

export const ticketRepository = AppDataSource.getRepository(TicketEntity);
export const ticketMessageRepository = AppDataSource.getRepository(TicketMessageEntity);
