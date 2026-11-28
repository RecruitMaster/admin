import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import AppDataSource from '@/config/database';
import { filters, loadSnapshot, pageData, validateYandex, saveYandex, YANDEX_KEY } from './seo.service';

declare module 'express-session' {
    interface SessionData {
        seoToken?: string;
    }
}
const router = Router();
router.use(async (req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    if (!req.session.user) return res.status(403).send('Нет доступа');
    const [admin] = await AppDataSource.query('SELECT role,status FROM "user" WHERE id=$1 AND deleted_at IS NULL', [
        req.session.user.id,
    ]);
    if (!admin || ![7, 8].includes(admin.role) || admin.status !== 2) return res.status(403).send('Нет доступа');
    next();
});
router.get('/', async (req, res) => {
    let selected;
    try {
        selected = filters(req.query);
    } catch {
        return res.status(400).send('Проверьте фильтры');
    }
    req.session.seoToken ||= crypto.randomBytes(32).toString('hex');
    const snapshot = loadSnapshot();
    const date = (v: string) =>
        v && Number.isFinite(Date.parse(v.replace(',', '.')))
            ? new Date(v.replace(',', '.')).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })
            : 'Ещё нет данных';
    const data = snapshot.data;
    const rows = data ? pageData(data, selected) : { rows: [], total: 0, totalPages: 1, page: 1 };
    const pageUrl = (page: number) =>
        '/seo?' +
        new URLSearchParams({
            ...selected,
            problems: selected.problems ? '1' : '',
            page: String(page),
        } as any).toString();
    return res.render('seo-dashboard', {
        data,
        rows,
        selected,
        error: snapshot.error,
        csrf: req.session.seoToken,
        date,
        pageUrl,
        yandexConfigured: fs.existsSync(YANDEX_KEY),
        message: ['yandex_connected', 'yandex_disconnected', 'yandex_failed'].includes(String(req.query.message))
            ? String(req.query.message)
            : '',
        stale: !!data && Date.now() - Date.parse(data.generatedAt) > 3600000,
    });
});
router.use((req, res, next) => {
    const token = req.body?.csrf;
    if (req.get('origin') && req.get('origin') !== 'https://admin.recruitmaster.net')
        return res.status(403).send('Обновите страницу');
    if (
        typeof token !== 'string' ||
        !req.session.seoToken ||
        !/^[a-f0-9]{64}$/.test(token) ||
        !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(req.session.seoToken))
    )
        return res.status(403).send('Обновите страницу');
    next();
});
router.post('/yandex', async (req, res) => {
    try {
        if (typeof req.body.token !== 'string') throw Error('missing_token');
        const config = await validateYandex(req.body.token.trim());
        saveYandex(config);
        return res.redirect('/seo?message=yandex_connected');
    } catch {
        return res.redirect('/seo?message=yandex_failed');
    }
});
router.post('/yandex/disconnect', (req, res) => {
    try {
        fs.unlinkSync(YANDEX_KEY);
    } catch (e: any) {
        if (e.code !== 'ENOENT') return res.status(503).send('Не удалось отключить Яндекс');
    }
    return res.redirect('/seo?message=yandex_disconnected');
});
export default router;
