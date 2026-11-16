import { Uuid } from '@/common/types/common.type';
import { USER_ROLES_REGISTER } from '@/api/users/types/user.constants';

declare module 'express-session' {
    export interface SessionData {
        personalMailToken?: string;
        personalMailLastSent?: number;
        user: {
            id: Uuid;
            name: string;
            surname: string;
        };
    }
}

export enum LANGUAGES {
    EN = 'en',
    RU = 'ru',
}

export type UserSettings = {
    lang?: LANGUAGES;
};

export type InviteUser = {
    email: string;
    name: string;
    surname: string;
    role: USER_ROLES_REGISTER.RECRUITER | USER_ROLES_REGISTER.CUSTOMER;
    inviteId: Uuid;
    createdAt: string;
};
