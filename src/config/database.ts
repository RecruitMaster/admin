import dotenv from 'dotenv';
import process from 'node:process';
import { DataSource } from 'typeorm';
dotenv.config();

const AppDataSource = new DataSource({
    host: process.env.DATABASE_HOST,
    port: +process.env.DATABASE_PORT!,
    username: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    type: 'postgres',
    synchronize: false,
    logging: Boolean(process.env.DATABASE_LOGGING),
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    ssl:
        process.env.DATABASE_SSL_ENABLED === 'true'
            ? {
                  rejectUnauthorized: process.env.DATABASE_REJECT_UNAUTHORIZED === 'true',
                  ca: process.env.DATABASE_CA ?? undefined,
                  key: process.env.DATABASE_KEY ?? undefined,
                  cert: process.env.DATABASE_CERT ?? undefined,
              }
            : undefined,
});

export default AppDataSource;
