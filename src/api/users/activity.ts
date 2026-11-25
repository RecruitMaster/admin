import { Request, Response } from 'express';
import AppDataSource from '@/config/database';
import { activitySummary, activityEvents } from './activity-report';
const ACTIVITY_ACTIONS: Record<string, string> = {
    'vacancy.created': 'Создал вакансию',
    'vacancy.updated': 'Изменил вакансию',
    'vacancy.archived': 'Отправил вакансию в архив',
    'vacancy.viewed': 'Открыл вакансию',
    'candidate.created': 'Добавил кандидата',
    'candidate.deleted': 'Удалил кандидата',
    'candidate.updated': 'Изменил анкету',
    'candidate.viewed': 'Открыл анкету',
    'candidate.stage_changed': 'Обновил статус кандидата',
    'candidate.added_to_vacancy': 'Добавил кандидатов в вакансию',
    'candidate.comment_added': 'Добавил комментарий к кандидату',
    'vacancy.comment_added': 'Добавил комментарий к вакансии',
    'meeting.created': 'Назначил встречу',
    'meeting.deleted': 'Удалил встречу',
    'profile.updated': 'Изменил свой профиль',
    'candidate.import_requested': 'Отправил резюме на импорт',
    'report.export_requested': 'Запросил выгрузку статистики',
    'candidate.resume_uploaded': 'Загрузил резюме',
};
export async function recruiterActivityPage(req: Request, res: Response) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!req.session.user) return res.status(403).send('Нет доступа');
    const [administrator] = await AppDataSource.query('SELECT role,status FROM "user" WHERE id=$1', [
        req.session.user.id,
    ]);
    if (!administrator || ![7, 8].includes(administrator.role) || administrator.status !== 2)
        return res.status(403).send('Нет доступа');
    const id = String(req.params.id);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
        return res.status(400).send('Некорректный рекрутер');
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Moscow' }).format(new Date());
    const from = typeof req.query.from === 'string' ? req.query.from : today,
        to = typeof req.query.to === 'string' ? req.query.to : today,
        action = typeof req.query.action === 'string' ? req.query.action : '',
        vacancyId = typeof req.query.vacancyId === 'string' ? req.query.vacancyId : '',
        page = Number(req.query.page ?? 1);
    const date = (v: string) =>
        /^\d{4}-\d{2}-\d{2}$/.test(v) &&
        Number(v.slice(0,4))>0 && !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
    if (
        !date(from) ||
        !date(to) ||
        from > to ||
        Date.parse(to) - Date.parse(from) > 366 * 86400000 ||
        (action && !Object.hasOwn(ACTIVITY_ACTIONS, action)) ||
        (vacancyId && !/^[0-9a-f-]{36}$/i.test(vacancyId)) ||
        !Number.isInteger(page) ||
        page < 1 ||
        page > 100000
    )
        return res.status(400).send('Проверьте фильтры журнала');
    const [recruiter] = await AppDataSource.query('SELECT id,name,surname FROM "user" WHERE id=$1 AND role=2', [id]);
    if (!recruiter) return res.status(404).send('Рекрутер не найден');
    try {
        const summary = await activitySummary(AppDataSource, id, null),
            log = await activityEvents(AppDataSource, id, null, {
                from,
                to,
                action: action || undefined,
                vacancyId: vacancyId || undefined,
                page,
            });
        const time = (seconds: number) => {
            const m = Math.floor(seconds / 60);
            return m >= 60
                ? `${Math.floor(m / 60)} ч ${m % 60} мин`
                : seconds > 0 && seconds < 60
                  ? 'Меньше минуты'
                  : `${m} мин`;
        };
        const dateTime = (value: string) => new Date(value).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
        const pageUrl = (n: number) =>
            '/users/' +
            encodeURIComponent(id) +
            '/activity?' +
            new URLSearchParams({ from, to, action, vacancyId, page: String(n) }).toString();
        return res.render('recruiter-activity', {
            recruiter,
            summary,
            log,
            filters: { from, to, action, vacancyId },
            labels: ACTIVITY_ACTIONS,
            time,
            dateTime,
            pageUrl,
        });
    } catch (e) {
        if ((e as any)?.code === '42P01')
            return res.status(503).send('Учёт активности ещё не подключён к серверу ATS.');
        throw e;
    }
}
