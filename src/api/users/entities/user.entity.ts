import { Uuid } from '@/common/types/common.type';
import { AbstractEntity } from '@/database/entities/abstract.entity';
import { hashPassword as hashPass } from '@/utils/password.util';
import {
    BeforeInsert,
    BeforeUpdate,
    Column,
    DeleteDateColumn,
    Entity,
    Index,
    JoinColumn,
    ManyToOne,
    OneToMany,
    PrimaryGeneratedColumn,
    Relation,
    VirtualColumn,
} from 'typeorm';
import { LANGUAGES, UserSettings } from '@/api/users/types/user.types';
import { TicketEntity } from '@/api/help/entities/ticket.entity';
import { USER_STATUSES } from '@/api/users/types/user.constants';

@Entity('user')
export class UserEntity extends AbstractEntity {
    constructor(data?: Partial<UserEntity>) {
        super();
        Object.assign(this, data);
    }

    @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_user_id' })
    id!: Uuid;

    @Column({
        length: 50,
        nullable: true,
    })
    @Column()
    @Index('UQ_user_email', { where: '"deleted_at" IS NULL', unique: true })
    email!: string;

    @Column()
    password!: string;

    @Column({
        name: 'company_name',
        default: '',
    })
    companyName?: string;

    @Column({ default: '' })
    name!: string;

    @Column({ default: '' })
    surname!: string;

    @Column({ default: '' })
    image?: string;

    @Column({
        type: 'int',
    })
    role!: number;

    @Column('jsonb', {
        default: {
            lang: LANGUAGES.EN,
        },
    })
    settings!: UserSettings;

    @Column('int', {
        default: USER_STATUSES.NOT_VERIFIED,
    })
    status!: number;

    @Column('uuid', {
        name: 'invite_user_id',
        nullable: true,
    })
    @Index('IX_invite_user_id')
    inviteUserId?: Uuid;

    @ManyToOne(() => UserEntity, (user) => user.inviteUserId)
    @JoinColumn({
        name: 'invite_user_id',
        referencedColumnName: 'id',
    })
    public inviteUser?: UserEntity;

    @DeleteDateColumn({
        name: 'deleted_at',
        type: 'timestamptz',
        default: null,
    })
    deletedAt!: Date;

    @BeforeInsert()
    @BeforeUpdate()
    async hashPassword() {
        if (this.password) {
            this.password = await hashPass(this.password);
        }
    }

    @OneToMany(() => TicketEntity, (ticket) => ticket.id)
    tickets?: Relation<TicketEntity>[];
}
