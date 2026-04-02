import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('system_setting')
export class SystemSettingEntity {
    @PrimaryColumn()
    id!: number;

    @Column({
        nullable: true,
        name: 'ai_parser_model',
    })
    aiParserModel?: string;

    @Column('text', {
        nullable: true,
        name: 'ai_parser_prompt',
    })
    aiParserPrompt?: string;
}
