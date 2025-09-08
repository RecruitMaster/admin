import { AbstractEntity } from '@/database/entities/abstract.entity';
import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, Relation } from 'typeorm';
import { Uuid } from '@/common/types/common.type';
import { TicketMessageEntity } from '@/api/help/entities/ticket-message.entity';
import { UserEntity } from '@/api/users/entities/user.entity';

@Entity('ticket')
export class TicketEntity extends AbstractEntity {
    constructor(data?: Partial<TicketEntity>) {
        super();
        Object.assign(this, data);
    }

    @PrimaryGeneratedColumn('uuid', {
        primaryKeyConstraintName: 'PK_ticket_id',
    })
    id!: Uuid;

    @Column()
    title!: string;

    @Column()
    description!: string;

    @Index('IX_ticket_user_id')
    @Column({
        type: 'uuid',
        name: 'user_id',
    })
    userId!: Uuid;

    @ManyToOne(() => UserEntity, (user) => user.id)
    @JoinColumn({
        name: 'user_id',
        referencedColumnName: 'id',
        foreignKeyConstraintName: 'FK_ticket_user',
    })
    recruiter!: Relation<UserEntity>;

    @OneToMany(() => TicketMessageEntity, (ticketMessage) => ticketMessage.ticket)
    messages?: Relation<TicketMessageEntity>[];
}
