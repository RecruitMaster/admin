import winston from 'winston';
import path from 'path';
import DailyRotateFile from 'winston-daily-rotate-file';

const customFormat = winston.format.printf((info) => {
    return new Date().toISOString() + '\n\r' + info.message + (info.stack ? '\n\r' + info.stack : '');
});

// Log unhandled exceptions to separate file
let exceptionHandlers = [
    new DailyRotateFile({
        filename: path.join(__dirname, '../../logs/err/exceptions-%DATE%.log'),
        datePattern: 'YYYY',
        zippedArchive: true,
        maxSize: '128k',
    }),
];

let transports = [
    new DailyRotateFile({
        filename: path.join(__dirname, '../../logs/err/errors-%DATE%.log'),
        datePattern: 'DD-MM-YYYY',
        zippedArchive: true,
        maxSize: '128k',
        level: 'error',
        format: customFormat,
    }),
    new DailyRotateFile({
        filename: path.join(__dirname, '../../logs/warn/warns-%DATE%.log'),
        datePattern: 'DD-MM-YYYY',
        zippedArchive: true,
        maxSize: '128k',
        level: 'warn',
        format: winston.format.combine(
            // filter warn messages, when error
            winston.format((info, opts) => {
                return info.level === 'warn' ? info : false;
            })(),
            customFormat,
        ),
    }),
    new DailyRotateFile({
        filename: path.join(__dirname, '../../logs/info/info-%DATE%.log'),
        datePattern: 'DD-MM-YYYY',
        zippedArchive: true,
        maxSize: '2m',
        level: 'info',
        format: winston.format.combine(
            // filter warn messages, when error
            winston.format((info, opts) => {
                return info.level === 'info' ? info : false;
            })(),
            customFormat,
        ),
    }),
];

const logger = winston.createLogger({
    transports: transports,
    exceptionHandlers: exceptionHandlers,
    exitOnError: false,
    // Default format
    format: winston.format.combine(customFormat),
});

export default logger;
