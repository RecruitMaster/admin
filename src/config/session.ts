import process from 'node:process';
import ms from 'ms';

export default {
    SECRET: process.env.SESSION_SECRET ?? 'secret',
    MAX_AGE: ms((process.env.SESSION_MAX_AGE as ms.StringValue) ?? '1h'),
    SECURE: Boolean(process.env.SESSION_SECURE),
};
