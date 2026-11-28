#!/usr/bin/env node
'use strict';
const fs = require('node:fs'),
    path = require('node:path'),
    crypto = require('node:crypto'),
    { spawnSync } = require('node:child_process');
const SITE = 'https://recruitmaster.net',
    DIR = '/var/lib/recruitmaster-seo',
    STATE = DIR + '/state.json',
    SNAPSHOT = DIR + '/snapshot.json',
    YANDEX = '/etc/recruitmaster/yandex-webmaster.json';
const INSPECT = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';
const TOKEN = 'https://oauth2.googleapis.com/token',
    YA = 'https://api.webmaster.yandex.net/v4';
const iso = (now) => new Date(now).toISOString();
function problem(code) {
    const e = new Error(code);
    e.code = code;
    throw e;
}
function url(value) {
    try {
        const u = new URL(value);
        if (
            u.origin !== SITE ||
            u.username ||
            u.password ||
            u.search ||
            u.hash ||
            /^\/(api|auth|admin)(\/|$)/.test(u.pathname)
        )
            problem('invalid_public_url');
        return u.href;
    } catch {
        problem('invalid_public_url');
    }
}
const kind = (u) => (u.includes('/jobs/') ? 'job' : u.includes('/hr/') ? 'profile' : 'page');
function privateJson(file) {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const s = fs.fstatSync(fd);
        if (!s.isFile() || s.uid !== process.getuid() || s.mode & 0o077 || s.size > 20 * 1024 * 1024)
            problem('private_file_permissions');
        return JSON.parse(fs.readFileSync(fd, 'utf8'));
    } finally {
        fs.closeSync(fd);
    }
}
function optional(file) {
    try {
        return privateJson(file);
    } catch (e) {
        if (e.code === 'ENOENT') return null;
        throw e;
    }
}
function write(file, data) {
    const temp = file + '.' + crypto.randomUUID() + '.tmp';
    let fd;
    try {
        fd = fs.openSync(temp, 'wx', 0o600);
        fs.writeFileSync(fd, JSON.stringify(data));
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(temp, file);
        const d = fs.openSync(path.dirname(file), 'r');
        try {
            fs.fsyncSync(d);
        } finally {
            fs.closeSync(d);
        }
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
}
function initial() {
    return { version: 1, google: {}, budget: { day: '', attempts: 0 }, googlePause: 0, yandex: null };
}
function state(file = STATE) {
    const s = optional(file) || initial();
    if (s.version !== 1 || !s.google || !s.budget || !Number.isSafeInteger(s.budget.attempts) || s.budget.attempts < 0)
        problem('invalid_state_do_not_reset');
    for (const u of Object.keys(s.google)) url(u);
    return s;
}
function xml(text, type) {
    if (!text.includes('<' + type) || !text.includes('</' + type + '>')) problem('invalid_sitemap');
    const loc = [...text.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => url(m[1]));
    if (loc.length > 50000) problem('sitemap_capacity');
    return loc;
}
async function discover(w, fetcher) {
    const headers = { Accept: 'application/xml', 'User-Agent': 'RecruitMasterSeoDashboard/1.0' };
    const r = await w.request(SITE + '/sitemap.xml', { headers }, fetcher);
    if (r.status !== 200) problem('sitemap_http_' + r.status);
    const maps = xml(r.text, 'sitemapindex');
    if (maps.length > 500) problem('sitemap_capacity');
    const pages = new Set(),
        results = [];
    for (const map of maps) {
        if (!/^https:\/\/recruitmaster\.net\/sitemap-(pages|jobs-[1-9]\d*|recruiters-[1-9]\d*)\.xml$/.test(map))
            problem('invalid_sitemap_child');
        const response = await w.request(map, { headers }, fetcher);
        if (response.status !== 200) problem('sitemap_child_http_' + response.status);
        const urls = xml(response.text, 'urlset');
        urls.forEach((u) => pages.add(u));
        results.push({ url: map, count: urls.length });
        if (pages.size > 10000) problem('sitemap_capacity');
    }
    return { urls: [...pages], maps: results };
}
async function jobInfo(w, fetcher) {
    const jobs = {};
    let total = 1;
    for (let page = 1; page <= total; page++) {
        const r = await w.request(
            'https://lk.recruitmaster.net/api/v1/public-vacancies?page=' + page + '&sort=newest',
            { headers: { Accept: 'application/json' } },
            fetcher,
        );
        if (r.status !== 200) problem('vacancies_http_' + r.status);
        const data = JSON.parse(r.text);
        if (
            !Array.isArray(data.data) ||
            data.pagination?.page !== page ||
            !Number.isSafeInteger(data.pagination.totalPages) ||
            data.pagination.totalPages > 500
        )
            problem('invalid_vacancies');
        total = data.pagination.totalPages;
        for (const j of data.data) {
            const u = url(SITE + '/jobs/' + j.id);
            const missing = [];
            if (!j.country?.trim()) missing.push('Страна');
            if (!j.city?.trim()) missing.push('Город');
            if (!j.publishedAt) missing.push('Дата публикации');
            if (!j.positionName?.trim()) missing.push('Название');
            if (
                !['exceptionalRequirements', 'workConditions', 'hardSkills', 'jobExperience', 'bonus'].some((k) =>
                    j[k]?.trim(),
                )
            )
                missing.push('Описание');
            jobs[u] = { title: String(j.positionName || '').slice(0, 300), missing };
        }
    }
    return jobs;
}
async function googleToken(c, w, fetcher, now) {
    const b = (x) => Buffer.from(JSON.stringify(x)).toString('base64url');
    const iat = Math.floor(now / 1000);
    const data =
        b({ alg: 'RS256', typ: 'JWT', ...(c.id ? { kid: c.id } : {}) }) +
        '.' +
        b({
            iss: c.email,
            scope: 'https://www.googleapis.com/auth/webmasters.readonly',
            aud: TOKEN,
            iat,
            exp: iat + 3600,
        });
    const jwt = data + '.' + crypto.sign('RSA-SHA256', Buffer.from(data), c.key).toString('base64url');
    const r = await w.request(
        TOKEN,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: jwt,
            }).toString(),
        },
        fetcher,
        65536,
    );
    if (r.status !== 200) problem('google_oauth_' + r.status);
    const token = JSON.parse(r.text).access_token;
    if (typeof token !== 'string' || !token || token.length > 8192 || /\s/.test(token)) problem('invalid_google_token');
    return token;
}
function inspection(data, now) {
    const s = data.inspectionResult?.indexStatusResult;
    if (!s || typeof s.verdict !== 'string') problem('invalid_inspection_response');
    return {
        status: s.verdict === 'PASS' ? 'indexed' : ['FAIL', 'NEUTRAL'].includes(s.verdict) ? 'not_indexed' : 'unknown',
        coverage: String(s.coverageState || '').slice(0, 500),
        canonical: String(s.googleCanonical || '').slice(0, 1000),
        lastCrawl: String(s.lastCrawlTime || '').slice(0, 80),
        checkedAt: iso(now),
    };
}
async function yaRequest(w, fetcher, token, route) {
    if (!route.startsWith('/user')) problem('invalid_yandex_route');
    const r = await w.request(
        YA + route,
        { headers: { Authorization: 'OAuth ' + token, Accept: 'application/json' } },
        fetcher,
    );
    if (r.status !== 200) problem('yandex_http_' + r.status);
    return JSON.parse(r.text.replace(/("user_id"\s*:\s*)(\d+)/g, '$1"$2"'));
}
async function yandexIdentity(w, fetcher, token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_.-]{10,4096}$/.test(token)) problem('invalid_yandex_token');
    const user = await yaRequest(w, fetcher, token, '/user');
    const id = String(user.user_id || '');
    if (!/^\d+$/.test(id)) problem('invalid_yandex_user');
    const hosts = await yaRequest(w, fetcher, token, '/user/' + id + '/hosts');
    const host = hosts.hosts?.find((h) => h.host_url === 'https://recruitmaster.net/' && h.verified === true);
    if (!host || host.host_id !== 'https:recruitmaster.net:443') problem('yandex_host_not_verified');
    return { userId: id, hostId: host.host_id };
}
async function yandexSamples(w, fetcher, config, now) {
    const identity = await yandexIdentity(w, fetcher, config.access_token);
    const base = '/user/' + identity.userId + '/hosts/' + encodeURIComponent(identity.hostId);
    const found = {};
    let count = 0;
    for (let offset = 0; offset < 10000; offset += 100) {
        const d = await yaRequest(
            w,
            fetcher,
            config.access_token,
            base + '/search-urls/in-search/samples?offset=' + offset + '&limit=100',
        );
        if (!Array.isArray(d.samples) || !Number.isSafeInteger(d.count) || d.count < 0)
            problem('invalid_yandex_response');
        count = d.count;
        for (const p of d.samples) {
            try {
                found[url(p.url)] = {
                    status: 'in_search',
                    checkedAt: iso(now),
                    lastCrawl: String(p.last_access || '').slice(0, 80),
                };
            } catch {}
        }
        if (offset + d.samples.length >= Math.min(count, 10000)) break;
        if (!d.samples.length) problem('incomplete_yandex_response');
    }
    const events = await yaRequest(
        w,
        fetcher,
        config.access_token,
        base + '/search-urls/events/samples?offset=0&limit=100',
    );
    if (!Array.isArray(events.samples)) problem('invalid_yandex_events');
    const latest = {};
    for (const p of events.samples) {
        try {
            const u = url(p.url);
            const at = Date.parse(String(p.event_date || '').replace(',', '.'));
            if (Number.isFinite(at) && (!latest[u] || at > latest[u].at)) latest[u] = { ...p, at };
        } catch {}
    }
    for (const p of Object.values(latest)) {
        try {
            const u = url(p.url);
            if (found[u] || p.event !== 'REMOVED_FROM_SEARCH') continue;
            found[u] = {
                status: 'excluded_reported',
                checkedAt: iso(now),
                reason: String(p.excluded_url_status || '').slice(0, 120),
                eventAt: String(p.event_date || '').slice(0, 80),
            };
        } catch {}
    }
    return { checkedAt: iso(now), count, sampleLimit: count > 10000, eventsLimited: (events.count || 0) > 100, found };
}
function notification(record) {
    if (!record) return { status: 'not_sent' };
    return {
        status: record.pending ? 'pending' : record.lastAcceptedAt ? 'accepted' : 'not_sent',
        acceptedAt: record.lastAcceptedAt || null,
        type: record.ackType || null,
    };
}
function buildSnapshot(s, urls, maps, jobs, worker, connections, now) {
    const pages = urls.map((u) => ({
        url: u,
        type: kind(u),
        inSitemap: true,
        title: jobs[u]?.title || '',
        missing: jobs[u]?.missing || [],
        google: s.google[u]
            ? { ...s.google[u], stale: now - Date.parse(s.google[u].checkedAt) > 36 * 3600000 }
            : { status: 'unknown', checkedAt: null },
        yandex: s.yandex?.found[u]
            ? { ...s.yandex.found[u], stale: now - Date.parse(s.yandex.checkedAt) > 36 * 3600000 }
            : { status: 'unknown', checkedAt: s.yandex?.checkedAt || null },
        notification: notification(worker?.jobs?.[u]),
    }));
    const summary = {
        total: pages.length,
        jobs: pages.filter((p) => p.type === 'job').length,
        profiles: pages.filter((p) => p.type === 'profile').length,
        other: pages.filter((p) => p.type === 'page').length,
        problems: pages.filter((p) => p.missing.length).length,
        googleIndexed: pages.filter((p) => p.google.status === 'indexed').length,
        googleNotIndexed: pages.filter((p) => p.google.status === 'not_indexed').length,
        googleUnknown: pages.filter((p) => p.google.status === 'unknown').length,
        yandexInSearch: pages.filter((p) => p.yandex.status === 'in_search').length,
    };
    const last = worker?.lastRun;
    return {
        version: 1,
        generatedAt: iso(now),
        connections,
        summary,
        sitemaps: maps,
        pages,
        googleBudget: s.budget,
        yandexReport: s.yandex
            ? {
                  checkedAt: s.yandex.checkedAt,
                  count: s.yandex.count,
                  sampleLimit: s.yandex.sampleLimit,
                  eventsLimited: s.yandex.eventsLimited,
              }
            : null,
        worker: worker
            ? {
                  scanned: Number(last?.scanned || 0),
                  accepted: Number(last?.accepted || 0),
                  totalAccepted: pages.filter((p) => p.type === 'job' && p.notification.acceptedAt).length,
                  pending: Object.values(worker.jobs || {}).filter((r) => r.pending).length,
                  finishedAt: last?.finishedAt || null,
                  errors: last?.errors || {},
              }
            : null,
    };
}
async function collect(s, options) {
    const {
        w,
        fetcher = fetch,
        clock = Date.now,
        save = () => {},
        credentials = w.credentials,
        yandex = null,
        worker = null,
        sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    } = options;
    const started = clock(),
        connections = {
            google: { status: 'setup_required', code: 'google_not_checked' },
            yandex: { status: yandex ? 'pending' : 'not_connected', code: yandex ? '' : 'yandex_not_connected' },
        };
    const discovered = await discover(w, fetcher);
    let jobs = {};
    try {
        jobs = await jobInfo(w, fetcher);
    } catch {
        connections.catalogue = { status: 'error', code: 'vacancies_unavailable' };
    }
    const date = w.day(started);
    if (s.budget.day !== date) s.budget = { day: date, attempts: 0 };
    let token;
    try {
        token = await googleToken(credentials(), w, fetcher, clock());
        connections.google = { status: 'ready', code: '' };
    } catch (e) {
        connections.google = { status: 'setup_required', code: e.code || 'google_credentials_unavailable' };
    }
    if (token && clock() >= (s.googlePause || 0)) {
        const due = discovered.urls
            .filter((u) => !s.google[u]?.checkedAt || clock() - Date.parse(s.google[u].checkedAt) > 86400000)
            .sort((a, b) => (Date.parse(s.google[a]?.checkedAt) || 0) - (Date.parse(s.google[b]?.checkedAt) || 0))
            .slice(0, 50);
        for (const u of due) {
            if (clock() - started > 8 * 60000) break;
            const d = w.day(clock());
            if (s.budget.day !== d) s.budget = { day: d, attempts: 0 };
            if (s.budget.attempts >= 1000) break;
            s.budget.attempts++;
            save(s);
            try {
                const r = await w.request(
                    INSPECT,
                    {
                        method: 'POST',
                        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            inspectionUrl: u,
                            siteUrl: 'sc-domain:recruitmaster.net',
                            languageCode: 'ru-RU',
                        }),
                    },
                    fetcher,
                );
                if (r.status !== 200) problem('google_inspect_' + r.status);
                s.google[u] = inspection(JSON.parse(r.text), clock());
                save(s);
            } catch (e) {
                connections.google = { status: 'error', code: e.code || 'google_inspect_failed' };
                if (/_(401|403|429)$/.test(connections.google.code)) {
                    s.googlePause = clock() + 3600000;
                    save(s);
                    break;
                }
            }
            await sleep(1000);
        }
    } else if (token && s.googlePause > clock()) connections.google = { status: 'paused', code: 'google_backoff' };
    if (yandex) {
        if (s.yandex && started - Date.parse(s.yandex.checkedAt) < 12 * 3600000)
            connections.yandex = { status: 'ready', code: '' };
        else
            try {
                s.yandex = await yandexSamples(w, fetcher, yandex, clock());
                connections.yandex = { status: 'ready', code: '' };
                save(s);
            } catch (e) {
                connections.yandex = { status: 'error', code: e.code || 'yandex_unavailable' };
            }
    }
    return buildSnapshot(s, discovered.urls, discovered.maps, jobs, worker, connections, clock());
}
async function main() {
    const w = require('/opt/recruitmaster-indexing/worker.cjs');
    if (process.argv[2] === '--check') {
        const d = await discover(w, fetch);
        let google = 'setup_required';
        try {
            const token = await googleToken(w.credentials(), w, fetch, Date.now());
            const r = await w.request(
                'https://www.googleapis.com/webmasters/v3/sites',
                { headers: { Authorization: 'Bearer ' + token } },
                fetch,
            );
            if (
                r.status === 200 &&
                JSON.parse(r.text).siteEntry?.some((s) => s.siteUrl === 'sc-domain:recruitmaster.net')
            )
                google = 'ready';
        } catch {}
        console.log(
            JSON.stringify({
                check: 'OK',
                pages: d.urls.length,
                google,
                inspectionRequestsSent: 0,
                indexingRequestsSent: 0,
            }),
        );
        return;
    }
    if (process.argv[2] === '--run') {
        const r = spawnSync(
            '/usr/bin/flock',
            ['-n', '-E', '0', DIR + '/run.lock', process.execPath, __filename, '--locked-run'],
            { stdio: 'inherit' },
        );
        if (r.status !== 0) problem('collector_failed');
        return;
    }
    if (process.argv[2] !== '--locked-run') problem('usage');
    const s = state();
    let yandex = null,
        worker = null,
        yandexInvalid = false;
    try {
        yandex = optional(YANDEX);
    } catch {
        yandexInvalid = true;
    }
    try {
        worker = optional('/var/lib/recruitmaster-indexing/state.json');
    } catch {}
    const snapshot = await collect(s, {
        w,
        save: (x) => write(STATE, x),
        yandex,
        worker,
    });
    if (yandexInvalid) snapshot.connections.yandex = { status: 'error', code: 'yandex_configuration_invalid' };
    write(SNAPSHOT, snapshot);
    console.log(
        JSON.stringify({
            pages: snapshot.summary.total,
            google: snapshot.connections.google,
            yandex: snapshot.connections.yandex,
            generatedAt: snapshot.generatedAt,
        }),
    );
}
module.exports = {
    SITE,
    DIR,
    STATE,
    SNAPSHOT,
    YANDEX,
    INSPECT,
    TOKEN,
    YA,
    url,
    kind,
    privateJson,
    optional,
    write,
    initial,
    state,
    xml,
    discover,
    jobInfo,
    googleToken,
    inspection,
    yandexIdentity,
    yandexSamples,
    notification,
    buildSnapshot,
    collect,
};
if (require.main === module)
    main().catch((e) => {
        console.error('SEO collector:', /^\w+$/.test(e.code || '') ? e.code : 'collection_failed');
        process.exitCode = 1;
    });
