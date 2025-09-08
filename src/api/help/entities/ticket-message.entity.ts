import { AbstractEntity } from '@/database/entities/abstract.entity';
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation } from 'typeorm';
import { Uuid } from '@/common/types/common.type';
import { UserEntity } from '@/api/users/entities/user.entity';
import { TicketEntity } from '@/api/help/entities/ticket.entity';

@Entity('ticket_message')
export class TicketMessageEntity extends AbstractEntity {
    constructor(data?: Partial<TicketMessageEntity>) {
        super();
        Object.assign(this, data);
    }

    @PrimaryGeneratedColumn('uuid', {
        primaryKeyConstraintName: 'PK_ticket_message_id',
    })
    id!: Uuid;

    @Column()
    text!: string;

    @Column({
        type: 'uuid',
        name: 'user_id',
    })
    userId!: Uuid;

    @ManyToOne(() => UserEntity, (user) => user.id)
    @JoinColumn({
        name: 'user_id',
        referencedColumnName: 'id',
        foreignKeyConstraintName: 'FK_ticket_message_user',
    })
    user!: Relation<UserEntity>;

    @Index('IX_ticket_message_ticket_id')
    @Column({
        type: 'uuid',
        name: 'ticket_id',
    })
    ticketId!: Uuid;

    @ManyToOne(() => TicketEntity, (ticket) => ticket.messages)
    @JoinColumn({
        name: 'ticket_id',
        referencedColumnName: 'id',
        foreignKeyConstraintName: 'FK_ticket_message_ticket',
    })
    ticket!: Relation<TicketEntity>;
}
