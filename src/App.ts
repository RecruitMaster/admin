import bodyParser from 'body-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import apiV1 from '@/api/index';
import path from 'path';
import AppDataSource from '@/config/database';
import { createClient } from 'redis';
import REDIS_CONFIG from '@/config/redis';
import SESSION_CONFIG from '@/config/session';
import session from 'express-session';
import { RedisStore } from 'connect-redis';
// import * as errorHandler from './helpers/errorHandler';

class App {
    public express: express.Application;
    public redisClient: ReturnType<typeof createClient>;

    constructor() {
        this.setDbConnect();
        this.express = express();
        this.redisClient = this.setRedisConnect();
        this.setViews();
        this.setMiddlewares();
        this.setRoutes();
        this.catchErrors();
    }

    private setMiddlewares(): void {
        this.express.use(express.static(path.resolve(__dirname, '..', 'public')));
        this.express.use(cors());
        this.express.use(bodyParser.json());
        this.express.use(bodyParser.urlencoded({ extended: false }));
        this.express.use(
            helmet({
                contentSecurityPolicy: {
                    directives: {
                        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
                        'script-src': ["'self'", "'unsafe-inline'", 'example.com'],
                        'img-src': ["'self'", 'data:', 'https://lk.recruitmaster.net'],
                    },
                },
            }),
        );
        this.express.use(
            session({
                store: new RedisStore({ client: this.redisClient }),
                name: 'admin-sess',
                secret: SESSION_CONFIG.SECRET,
                resave: false,
                saveUninitialized: false,
                cookie: {
                    secure: SESSION_CONFIG.SECURE,
                    httpOnly: true,
                    maxAge: SESSION_CONFIG.MAX_AGE,
                },
            }),
        );
    }

    private setViews() {
        this.express.set('views', path.join(__dirname, 'views'));
        this.express.set('view engine', 'ejs');
    }

    private setRoutes(): void {
        this.express.use('/', apiV1);
    }

    private setDbConnect() {
        AppDataSource.initialize().catch((err: Error) => {
            console.error('Database connect error:', err);
        });
    }

    private setRedisConnect() {
        const redisClient = createClient({
            url: REDIS_CONFIG.REDIS_URL,
        });
        redisClient.on('error', (err) => console.log('Redis Client Error', err));
        redisClient.connect().catch(console.error);
        return redisClient;
    }

    private catchErrors(): void {
        // this.express.use(errorHandler.notFound);
        // this.express.use(errorHandler.internalServerError);
    }
}

export default new App().express;
