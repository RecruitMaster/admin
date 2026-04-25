import { AbstractEntity } from '@/database/entities/abstract.entity';
import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Relation } from 'typeorm';
import { Uuid } from '@/common/types/common.type';
import { UserEntity } from '@/api/users/entities/user.entity';

@Entity('candidate')
export class CandidateEntity extends AbstractEntity {
    constructor(data?: Partial<CandidateEntity>) {
        super();
        Object.assign(this, data);
    }

    @PrimaryGeneratedColumn('uuid', {
        primaryKeyConstraintName: 'PK_candidate_id',
    })
    id!: Uuid;

    @Column({
        type: 'uuid',
        name: 'recruiter_id',
    })
    @Index('IX_candidate_recruiter_id')
    recruiterId!: Uuid;

    @ManyToOne(() => UserEntity, (user) => user.candidates)
    @JoinColumn({
        name: 'recruiter_id',
        referencedColumnName: 'id',
        foreignKeyConstraintName: 'FK_candidate_user',
    })
    recruiter!: Relation<UserEntity>;
}
