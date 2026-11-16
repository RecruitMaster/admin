import { Request, Response } from 'express';
import { Uuid } from '@/common/types/common.type';
import nodemailer from 'nodemailer';
import userRepository from './users.service';
const FROM = 'dkechkin@recruitmaster.net';
const inFlight = new Set<string>();
export async function sendPersonalMail(req: Request, res: Response) {
    if (!req.session.personalMailToken || req.body.token !== req.session.personalMailToken)
        return res.status(403).json({message:'Обнови страницу перед отправкой.'});
    const subject = req.body.subject, text = req.body.text;
    if (typeof subject !== 'string' || !subject.trim() || subject.length > 200 || /[\r\n]/.test(subject) ||
        typeof text !== 'string' || !text.trim() || text.length > 10000 || !/^[0-9a-f-]{36}$/i.test(String(req.params.id)))
        return res.status(400).json({message:'Укажи тему до 200 символов и текст до 10 000 символов.'});
    const owner = req.session.user!.id;
    if (inFlight.has(owner) || Date.now() - (req.session.personalMailLastSent || 0) < 30000)
        return res.status(429).json({message:'Подожди 30 секунд перед следующим письмом.'});
    const user = await userRepository.findOne({where:{id:String(req.params.id) as Uuid}});
    if (!user || user.role !== 2 || ![1,2].includes(user.status) || !user.email || /[\r\n]/.test(user.email))
        return res.status(400).json({message:'Письмо доступно для действующего аккаунта рекрутера.'});
    const env = process.env;
    if (env.ADMIN_MAIL_ENABLED !== 'true' || !env.ADMIN_MAIL_HOST || !env.ADMIN_MAIL_USER || !env.ADMIN_MAIL_PASSWORD)
        return res.status(503).json({message:'Отправка не настроена: подключи SMTP ящика dkechkin@recruitmaster.net.'});
    const port = Number(env.ADMIN_MAIL_PORT || 465);
    if (![465,587].includes(port)) return res.status(503).json({message:'SMTP должен использовать TLS: порт 465 или 587.'});
    if (inFlight.has(owner)) return res.status(429).json({message:'Предыдущее письмо ещё отправляется.'});
    inFlight.add(owner);
    req.session.personalMailLastSent = Date.now();
    const transport = nodemailer.createTransport({host:env.ADMIN_MAIL_HOST,port,secure:port===465,requireTLS:true,
        auth:{user:env.ADMIN_MAIL_USER,pass:env.ADMIN_MAIL_PASSWORD},connectionTimeout:10000,socketTimeout:20000});
    try {
        const result = await transport.sendMail({from:{name:'Денис Кечкин · Recruit Master',address:FROM},
            replyTo:FROM,to:{address:user.email,name:[user.name,user.surname].filter(Boolean).join(' ')},
            subject:subject.trim(),text:text.trim(),disableFileAccess:true,disableUrlAccess:true});
        if (!result.accepted?.some(v => String(v).toLowerCase() === user.email.toLowerCase())) throw new Error('not accepted');
        console.info('ADMIN_PERSONAL_MAIL_ACCEPTED', {adminId:owner,recipientId:user.id});
        return res.json({message:'Почтовый сервер принял письмо. Это ещё не подтверждение доставки.'});
    } catch {
        return res.status(502).json({message:'Не удалось подтвердить отправку. Проверь папку отправленных или почтовый журнал перед повтором.'});
    } finally { inFlight.delete(owner); transport.close(); }
}
