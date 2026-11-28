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
// Only fixed messages/codes reach the browser. Never reflect provider bodies,
// filesystem errors or credentials, including messages from unexpected errors.
const yandexErrors: Record<string, string> = {
    invalid_yandex_token: 'Вставьте только OAuth-токен целиком, без адреса страницы и параметров ссылки.',
    yandex_unauthorized: 'Яндекс не принял токен: он недействителен или отозван. Получите новый OAuth-токен.',
    yandex_forbidden: 'Яндекс запретил доступ. Проверьте право webmaster:hostinfo и получите токен заново после изменения прав.',
    yandex_host_missing: 'В аккаунте владельца токена нет сайта https://recruitmaster.net/. Добавьте этот адрес в Яндекс.Вебмастер или используйте токен нужного аккаунта.',
    yandex_host_not_verified: 'Сайт https://recruitmaster.net/ найден, но права на него не подтверждены в аккаунте владельца токена.',
    yandex_network_error: 'Сервер не смог связаться с API Яндекс.Вебмастера. Повторите подключение позже.',
    yandex_unavailable: 'API Яндекс.Вебмастера временно недоступен или ограничил запросы. Повторите подключение позже.',
    invalid_yandex_response: 'API Яндекс.Вебмастера вернул неожиданный ответ. Нужна проверка интеграции.',
    yandex_save_failed: 'Доступ к Яндексу подтверждён, но сервер не смог сохранить токен. Нужна проверка прав каталога настроек.',
};
router.use(async (req, res, next) => {
    res.set({
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow',
        // Helmet's global no-referrer policy produces Origin: null on native
        // form POSTs. Same-origin retains the real Origin for this private form
        // and still withholds the Referer on all external navigations.
        'Referrer-Policy': 'same-origin',
    });
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
        message: ['yandex_connected', 'yandex_disconnected', 'yandex_failed', 'form_expired'].includes(String(req.query.message))
            ? String(req.query.message)
            : '',
        stale: !!data && Date.now() - Date.parse(data.generatedAt) > 3600000,
        yandexError: Object.prototype.hasOwnProperty.call(yandexErrors, String(req.query.reason))
            ? yandexErrors[String(req.query.reason)] : 'Не удалось подключить Яндекс. Нужна проверка интеграции.',
    });
});
router.use((req, res, next) => {
    const token = req.body?.csrf;
    if (req.get('origin') && req.get('origin') !== 'https://admin.recruitmaster.net')
        return res.status(403).send('Запрос отклонён');
    if (
        typeof token !== 'string' ||
        !req.session.seoToken ||
        !/^[a-f0-9]{64}$/.test(token) ||
        !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(req.session.seoToken))
    )
        return res.redirect(303, '/seo?message=form_expired');
    next();
});
router.post('/yandex', async (req, res) => {
    try {
        if (typeof req.body.token !== 'string') throw Error('missing_token');
        const config = await validateYandex(req.body.token.trim());
        try { saveYandex(config); } catch { throw Error('yandex_save_failed'); }
        return res.redirect(303, '/seo?message=yandex_connected');
    } catch (error: unknown) {
        const reason = error instanceof Error && Object.prototype.hasOwnProperty.call(yandexErrors, error.message)
            ? error.message : 'unknown';
        return res.redirect(303, '/seo?message=yandex_failed&reason=' + reason);
    }
});
router.post('/yandex/disconnect', (req, res) => {
    try {
        fs.unlinkSync(YANDEX_KEY);
    } catch (e: any) {
        if (e.code !== 'ENOENT') return res.status(503).send('Не удалось отключить Яндекс');
    }
    return res.redirect(303, '/seo?message=yandex_disconnected');
});
export default router;
