import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('onboarding-question')
export class OnboardingQuestionEntity {
    constructor(data?: Partial<OnboardingQuestionEntity>) {
        Object.assign(this, data);
    }

    @PrimaryGeneratedColumn('increment', {
        primaryKeyConstraintName: 'PK_onboarding_question_id',
    })
    id!: number;

    @Column({
        type: 'text',
    })
    text!: string;
}
