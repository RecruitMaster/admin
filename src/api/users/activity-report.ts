export interface ActivityDb {
    query(sql: string, args?: any[]): Promise<any[]>;
}
export async function activitySummary(
    db: ActivityDb,
    userId: string,
    organizationId: string | null,
    now = new Date(),
) {
    const [row] = await db.query(
        `WITH bounds AS (
 SELECT $3::timestamptz AS now, date_trunc('day',$3::timestamptz AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow' AS today,
 date_trunc('week',$3::timestamptz AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow' AS week
 ), days AS (SELECT generate_series(week,today,interval '1 day') AS day FROM bounds),
 unions AS (SELECT days.day,range_agg(tstzrange(greatest(i.started_at,days.day),least(i.ended_at,days.day+interval '1 day',bounds.now),'[)')) FILTER (WHERE i.id IS NOT NULL) AS spans
 FROM days CROSS JOIN bounds LEFT JOIN recruiter_activity_interval i ON i.user_id=$1 AND ($2::uuid IS NULL OR i.organization_id=$2)
 AND i.ended_at>days.day AND i.started_at<least(days.day+interval '1 day',bounds.now)
 GROUP BY days.day), totals AS (SELECT day,coalesce((SELECT sum(extract(epoch FROM upper(span)-lower(span))) FROM unnest(spans) AS span),0)::float8 AS seconds FROM unions)
 SELECT coalesce(sum(seconds),0)::float8 AS "weekSeconds",coalesce(sum(seconds) FILTER(WHERE day=(SELECT today FROM bounds)),0)::float8 AS "todaySeconds",
 coalesce(jsonb_agg(jsonb_build_object('date',to_char(day AT TIME ZONE 'Europe/Moscow','YYYY-MM-DD'),'seconds',seconds) ORDER BY day),'[]') AS days,
 (SELECT started_at FROM recruiter_activity_config WHERE id=true) AS "startedAt" FROM totals`,
        [userId, organizationId, now.toISOString()],
    );
    return { ...row, timezone: 'Europe/Moscow', generatedAt: now.toISOString() };
}
export async function activityEvents(
    db: ActivityDb,
    userId: string,
    organizationId: string | null,
    filter: { from?: string; to?: string; action?: string; vacancyId?: string; page?: number } = {},
) {
    const args: any[] = [userId, organizationId],
        conditions = ['e.user_id=$1', '($2::uuid IS NULL OR e.organization_id=$2)'];
    const bind = (v: any) => {
        args.push(v);
        return '$' + args.length;
    };
    if (filter.from)
        conditions.push(
            'e.created_at >= ' + bind(filter.from) + "::date AT TIME ZONE 'Europe/Moscow'",
        );
    if (filter.to)
        conditions.push(
            'e.created_at < (' + bind(filter.to) + "::date+1) AT TIME ZONE 'Europe/Moscow'",
        );
    if (filter.action) conditions.push('e.action=' + bind(filter.action));
    if (filter.vacancyId) conditions.push('e.vacancy_id=' + bind(filter.vacancyId) + '::uuid');
    const where = conditions.join(' AND '),
        page = filter.page ?? 1;
    const [{ total }] = await db.query(
        'SELECT count(*)::int AS total FROM recruiter_activity_event e WHERE ' + where,
        args,
    );
    const rows = await db.query(
        `SELECT e.id::text,e.created_at AS "createdAt",e.action,e.vacancy_id AS "vacancyId",e.candidate_id AS "candidateId",e.metadata FROM recruiter_activity_event e WHERE ${where} ORDER BY e.created_at DESC,e.id DESC LIMIT 50 OFFSET ${bind((page - 1) * 50)}`,
        args,
    );
    return { events: rows, total, page, totalPages: Math.ceil(total / 50) };
}
