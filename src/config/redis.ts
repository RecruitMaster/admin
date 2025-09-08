import process from 'node:process';

const redisHost = process.env.REDIS_HOST;
const redisPort = process.env.REDIS_PORT;
const redisPassword = process.env.REDIS_PASSWORD;

export default {
    REDIS_URL: `redis://:${redisPassword}@${redisHost}:${redisPort}`,
};
