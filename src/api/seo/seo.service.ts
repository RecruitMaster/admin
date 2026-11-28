import fs from 'node:fs';
import path from 'node:path';

export const SNAPSHOT = '/var/lib/recruitmaster-seo/snapshot.json';
export const YANDEX_KEY = '/etc/recruitmaster/yandex-webmaster.json';
const SITE = 'https://recruitmaster.net';
export function publicUrl(value: unknown): string | null {
    try {
        const u = new URL(String(value));
        return u.origin === SITE &&
            !u.username &&
            !u.password &&
            !u.search &&
            !u.hash &&
            !/^\/(api|auth|admin)(\/|$)/.test(u.pathname)
            ? u.href
            : null;
    } catch {
        return null;
    }
}
const text = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
export function readPrivate(file: string) {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const st = fs.fstatSync(fd);
        if (!st.isFile() || st.size > 20 * 1024 * 1024 || st.mode & 0o077 || st.uid !== process.getuid!())
            throw Error('private_file_permissions');
        return JSON.parse(fs.readFileSync(fd, 'utf8'));
    } finally {
        fs.closeSync(fd);
    }
}
export function sanitizeSnapshot(raw: any) {
    if (
        raw?.version !== 1 ||
        !Array.isArray(raw.pages) ||
        raw.pages.length > 10000 ||
        !raw.generatedAt ||
        !Number.isFinite(Date.parse(raw.generatedAt))
    )
        throw Error('invalid_snapshot');
    const pages = raw.pages.map((p: any) => {
        const url = publicUrl(p.url);
        if (!url) throw Error('invalid_snapshot_url');
        const g = p.google || {},
            y = p.yandex || {},
            n = p.notification || {};
        return {
            url,
            type: ['job', 'profile', 'page'].includes(p.type) ? p.type : 'page',
            title: text(p.title, 300),
            missing: Array.isArray(p.missing) ? p.missing.slice(0, 10).map((v: unknown) => text(v, 80)) : [],
            inSitemap: p.inSitemap === true,
            google: {
                status: ['indexed', 'not_indexed'].includes(g.status) ? g.status : 'unknown',
                checkedAt: text(g.checkedAt, 80),
                coverage: text(g.coverage),
                canonical: text(g.canonical, 1000),
                lastCrawl: text(g.lastCrawl, 80),
                stale: g.stale === true,
            },
            yandex: {
                status: ['in_search', 'excluded_reported'].includes(y.status) ? y.status : 'unknown',
                checkedAt: text(y.checkedAt, 80),
                reason: text(y.reason, 120),
                eventAt: text(y.eventAt, 80),
                lastCrawl: text(y.lastCrawl, 80),
                stale: y.stale === true,
            },
            notification: {
                status: ['accepted', 'pending'].includes(n.status) ? n.status : 'not_sent',
                acceptedAt: text(n.acceptedAt, 80),
            },
        };
    });
    const connection = (v: any) => ({ status: text(v?.status, 40), code: text(v?.code, 100) });
    const summary = {
        total: pages.length,
        jobs: pages.filter((p: any) => p.type === 'job').length,
        profiles: pages.filter((p: any) => p.type === 'profile').length,
        other: pages.filter((p: any) => p.type === 'page').length,
        problems: pages.filter((p: any) => p.missing.length).length,
        googleIndexed: pages.filter((p: any) => p.google.status === 'indexed').length,
        googleNotIndexed: pages.filter((p: any) => p.google.status === 'not_indexed').length,
        googleUnknown: pages.filter((p: any) => p.google.status === 'unknown').length,
        yandexInSearch: pages.filter((p: any) => p.yandex.status === 'in_search').length,
    };
    return {
        version: 1,
        generatedAt: raw.generatedAt,
        pages,
        summary,
        connections: {
            google: connection(raw.connections?.google),
            yandex: connection(raw.connections?.yandex),
            catalogue: connection(raw.connections?.catalogue),
        },
        sitemaps: Array.isArray(raw.sitemaps)
            ? raw.sitemaps
                  .slice(0, 500)
                  .filter((m: any) => publicUrl(m.url) && Number.isFinite(m.count))
                  .map((m: any) => ({ url: publicUrl(m.url), count: m.count }))
            : [],
        googleBudget: { attempts: Number(raw.googleBudget?.attempts) || 0, day: text(raw.googleBudget?.day, 12) },
        worker: raw.worker
            ? {
                  accepted: Number(raw.worker.accepted) || 0,
                  totalAccepted: Number(raw.worker.totalAccepted) || 0,
                  scanned: Number(raw.worker.scanned) || 0,
                  pending: Number(raw.worker.pending) || 0,
                  finishedAt: text(raw.worker.finishedAt, 80),
              }
            : null,
        yandexReport: raw.yandexReport
            ? {
                  checkedAt: text(raw.yandexReport.checkedAt, 80),
                  count: Number(raw.yandexReport.count) || 0,
                  sampleLimit: raw.yandexReport.sampleLimit === true,
                  eventsLimited: raw.yandexReport.eventsLimited === true,
              }
            : null,
    };
}
export function loadSnapshot(file = SNAPSHOT) {
    try {
        return { data: sanitizeSnapshot(readPrivate(file)), error: '' };
    } catch (e: any) {
        return { data: null, error: e.code === 'ENOENT' ? 'snapshot_pending' : 'snapshot_unavailable' };
    }
}
export function filters(query: Record<string, unknown>) {
    const result = {
        q: typeof query.q === 'string' ? query.q.trim().slice(0, 200) : '',
        type: typeof query.type === 'string' ? query.type : '',
        google: typeof query.google === 'string' ? query.google : '',
        yandex: typeof query.yandex === 'string' ? query.yandex : '',
        problems: query.problems === '1',
        page: Number(query.page || 1),
    };
    if (
        !['', 'job', 'profile', 'page'].includes(result.type) ||
        !['', 'indexed', 'not_indexed', 'unknown'].includes(result.google) ||
        !['', 'in_search', 'excluded_reported', 'unknown'].includes(result.yandex) ||
        !Number.isSafeInteger(result.page) ||
        result.page < 1 ||
        result.page > 10000
    )
        throw Error('invalid_filters');
    return result;
}
export function pageData(data: ReturnType<typeof sanitizeSnapshot>, f: ReturnType<typeof filters>) {
    const q = f.q.toLocaleLowerCase('ru');
    const selected = data.pages.filter(
        (p: any) =>
            (!f.type || p.type === f.type) &&
            (!f.google || p.google.status === f.google) &&
            (!f.yandex || p.yandex.status === f.yandex) &&
            (!f.problems || p.missing.length) &&
            (!q || (p.url + ' ' + p.title).toLocaleLowerCase('ru').includes(q)),
    );
    const totalPages = Math.max(1, Math.ceil(selected.length / 50)),
        page = Math.min(f.page, totalPages);
    return { rows: selected.slice((page - 1) * 50, page * 50), total: selected.length, totalPages, page };
}
export async function validateYandex(token: string, fetcher: typeof fetch = fetch) {
    if (!/^[A-Za-z0-9_.-]{10,4096}$/.test(token)) throw Error('invalid_yandex_token');
    async function read(route: string) {
        let r: Response;
        try { r = await fetcher('https://api.webmaster.yandex.net/v4' + route, {
            headers: { Authorization: 'OAuth ' + token, Accept: 'application/json' },
            redirect: 'manual',
            credentials: 'omit',
            signal: AbortSignal.timeout(10000),
        }); } catch { throw Error('yandex_network_error'); }
        if (r.status === 401) throw Error('yandex_unauthorized');
        if (r.status === 403) throw Error('yandex_forbidden');
        if (r.status !== 200) throw Error('yandex_unavailable');
        let body: string;
        try { body = await r.text(); } catch { throw Error('yandex_network_error'); }
        if (body.length > 1024 * 1024) throw Error('invalid_yandex_response');
        try { return JSON.parse(body.replace(/("user_id"\s*:\s*)(\d+)/g, '$1"$2"')); }
        catch { throw Error('invalid_yandex_response'); }
    }
    const user = await read('/user'),
        id = String(user?.user_id || '');
    if (!/^\d+$/.test(id)) throw Error('invalid_yandex_response');
    const hosts = await read('/user/' + id + '/hosts');
    if (!Array.isArray(hosts?.hosts)) throw Error('invalid_yandex_response');
    const host = hosts.hosts.find((h: any) => h?.ascii_host_url === 'https://recruitmaster.net/' &&
        h.host_id === 'https:recruitmaster.net:443');
    if (!host) throw Error('yandex_host_missing');
    if (host.verified !== true) throw Error('yandex_host_not_verified');
    return { access_token: token };
}
export function saveYandex(config: { access_token: string }, file = YANDEX_KEY) {
    if (fs.lstatSync(path.dirname(file)).isSymbolicLink() || fs.statSync(path.dirname(file)).uid !== process.getuid!())
        throw Error('unsafe_key_directory');
    try {
        if (fs.lstatSync(file).isSymbolicLink()) throw Error('unsafe_key_file');
    } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
    }
    const tmp = file + '.' + require('node:crypto').randomUUID() + '.tmp';
    const fd = fs.openSync(tmp, 'wx', 0o600);
    try {
        fs.writeFileSync(fd, JSON.stringify(config));
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    try {
        fs.renameSync(tmp, file);
    } finally {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
}
