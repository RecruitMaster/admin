import { Request, Response } from 'express';
import db from '@/config/database';
export async function candidateEvents(req: Request, res: Response) {
    const page = Math.min(10000, Math.max(1, Number(req.query.page) || 1));
    if (!Number.isInteger(page)) return res.status(400).send('Некорректная страница');
    const candidate = String(req.query.candidate || '');
    if (candidate && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(candidate))
        return res.status(400).send('Некорректный ID кандидата');
    const limit = 30;
    const [total] = await db.query(
        'SELECT count(*)::int n FROM candidate_contact_event WHERE ($1::uuid IS NULL OR candidate_user_id=$1)',
        [candidate || null],
    );
    const rows = await db.query(
        `SELECT e.action,e.channel,e.created_at,e.candidate_user_id,e.recruiter_user_id,concat_ws(' ',c.name,c.surname) AS candidate,concat_ws(' ',r.name,r.surname) AS recruiter FROM candidate_contact_event e LEFT JOIN "user" c ON c.id=e.candidate_user_id LEFT JOIN "user" r ON r.id=e.recruiter_user_id WHERE ($1::uuid IS NULL OR e.candidate_user_id=$1) ORDER BY e.id DESC LIMIT $2 OFFSET $3`,
        [candidate || null, limit, (page - 1) * limit],
    );
    const consents = await db.query(
        `SELECT e.kind,e.accepted,e.source,e.document_version,e.document_text,e.created_at,concat_ws(' ',u.name,u.surname) AS candidate FROM candidate_consent_event e LEFT JOIN "user" u ON u.id=e.user_id WHERE ($1::uuid IS NULL OR e.user_id=$1) ORDER BY e.id DESC LIMIT 30`,
        [candidate || null],
    );
    res.render('candidate-events', { rows, consents, candidate, page, pages: Math.max(1, Math.ceil(total.n / limit)) });
}
