import dotenv from 'dotenv';
import process from 'node:process';
dotenv.config();

export default {
    APP: process.env.NODE_ENV || 'development',
    PORT: process.env.APP_PORT || '3000',

    JWT_SECRET: process.env.JWT_SECRET || 'secret',
    JWT_ENCRYPTION: process.env.JWT_ENCRYPTION || 'jwt_please_change',
    JWT_EXPIRATION: process.env.JWT_EXPIRATION || '1h',
    SALT_ROUNDS: process.env.SALT_ROUNDS || 10,

    FILE_PUBLIC_DIR: process.env.FILE_PUBLIC_DIR || 'true',
    FILE_UPLOAD_PATH: process.env.FILE_UPLOAD_PATH || '',
};
