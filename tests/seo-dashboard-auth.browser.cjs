// Real browser forms, Helmet and express-session; external APIs/storage are mocked.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const https = require('node:https');
const { execFileSync } = require('node:child_process');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const service = require('../dist/api/seo/seo.service.js');
const databaseId = require.resolve('../dist/config/database.js');
require.cache[databaseId] = { id: databaseId, filename: databaseId, loaded: true,
    exports: { __esModule: true, default: { query: async () => [{ role: 8, status: 2 }] } } };
service.loadSnapshot = () => ({ data: null, error: '' });
const calls = [], writes = [], posts = [];
const token = 'local-test-only-never-a-real-token';
const validateYandex = service.validateYandex;
service.validateYandex = async value => {
    calls.push(value);
    return validateYandex(value, async url => {
        if (value !== token && value !== 'storage-failure-test-token') return new Response('{}', { status: 401 });
        return url.endsWith('/v4/user') ? Response.json({ user_id: 123 }) : Response.json({ hosts: [
            { host_id: 'https:recruitmaster.net:443', ascii_host_url: 'https://recruitmaster.net/', verified: true }
        ] });
    });
};
service.saveYandex = value => { if (value.access_token === 'storage-failure-test-token') throw Error('private-file-error'); writes.push(value); };
const router = require('../dist/api/seo/seo.route.js').default;
const app = express();
app.use(helmet());
app.use(express.urlencoded({ extended: false }));
app.use(session({ secret: 'local-test-session-only', resave: false, saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' } }));
app.set('view engine', 'ejs');
app.set('views', path.resolve(__dirname, '../src/views'));
app.get('/fixture-login', (req, res) => { req.session.user = { id: 'admin', name: 'Test', surname: 'Admin' }; res.redirect('/seo'); });
app.use((req, res, next) => { res.locals.user = req.session.user; if (req.method === 'POST') posts.push({ origin: req.get('origin'), path: req.path }); next(); });
app.use('/seo', router);

(async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-browser-tls-'));
    const key = path.join(temp, 'key.pem'), cert = path.join(temp, 'cert.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
        '-out', cert, '-days', '1', '-subj', '/CN=admin.recruitmaster.net'], { stdio: 'ignore' });
    const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, app).listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const local = 'https://127.0.0.1:' + server.address().port;
    const origin = 'https://admin.recruitmaster.net';
    let browser;
    try {
        browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true,
            args: ['--no-sandbox', '--no-proxy-server', '--host-resolver-rules=MAP admin.recruitmaster.net 127.0.0.1:' + server.address().port] });
        const context = await browser.newContext({ ignoreHTTPSErrors: true });
        // Resolve the production hostname to this local TLS fixture, including
        // native redirects. External assets are blocked; APIs/storage are mocked.
        await context.route('**/*', async route => {
            const request = route.request(), url = new URL(request.url());
            if (url.origin !== origin) return route.abort();
            await route.continue();
        });
        const page = await context.newPage();
        const initial = await page.goto(origin + '/fixture-login');
        assert.equal(initial.headers()['referrer-policy'], 'same-origin');
        await page.getByLabel('OAuth-токен', { exact: true }).fill(token);
        await Promise.all([page.waitForURL('**/seo?message=yandex_connected'), page.getByRole('button', { name: 'Проверить и подключить' }).click()]);
        assert.equal(posts[0].origin, origin);
        assert.deepEqual(calls, [token]); assert.equal(writes.length, 1);
        assert.ok(!(await page.content()).includes(token));
        const count = posts.length;
        await page.reload();
        assert.equal(posts.length, count, 'reload after success must be a GET');
        await page.locator('form[action="/seo/yandex"] input[name="csrf"]').evaluate(input => input.value = '0'.repeat(64));
        await page.getByLabel('OAuth-токен', { exact: true }).fill(token);
        await Promise.all([page.waitForURL('**/seo?message=form_expired'), page.getByRole('button', { name: 'Проверить и подключить' }).click()]);
        assert.equal(writes.length, 1); assert.equal(calls.length, 1);
        assert.ok((await page.textContent('body')).includes('Форма устарела'));
        assert.ok(!(await page.content()).includes(token));
        const csrf = await page.locator('input[name="csrf"]').first().inputValue();
        for (const source of ['https://evil.example', 'null']) {
            const response = await context.request.post(local + '/seo/yandex', {
                headers: { Origin: source, Cookie: (await context.cookies(origin)).map(c => c.name + '=' + c.value).join('; ') },
                form: { csrf, token }, maxRedirects: 0 });
            assert.equal(response.status(), 403);
        }
        assert.equal(calls.length, 1); assert.equal(writes.length, 1);
        await page.getByLabel('OAuth-токен', { exact: true }).fill('invalid-local-token');
        await Promise.all([page.waitForURL('**/seo?message=yandex_failed&reason=yandex_unauthorized'), page.getByRole('button', { name: 'Проверить и подключить' }).click()]);
        assert.equal(writes.length, 1);
        assert.ok((await page.textContent('body')).includes('Яндекс не принял токен'));
        assert.ok(!(await page.content()).includes('invalid-local-token'));
        await page.reload(); assert.equal(posts.length, count + 4);
        await page.getByLabel('OAuth-токен', { exact: true }).fill('storage-failure-test-token');
        await Promise.all([page.waitForURL('**/seo?message=yandex_failed&reason=yandex_save_failed'), page.getByRole('button', { name: 'Проверить и подключить' }).click()]);
        assert.equal(writes.length, 1);
        const failedHtml = await page.content();
        assert.ok(failedHtml.includes('сервер не смог сохранить токен'));
        assert.ok(!failedHtml.includes('private-file-error'));
        assert.ok(!failedHtml.includes('storage-failure-test-token'));
        await page.goto(origin + '/seo?message=yandex_failed&reason=' + encodeURIComponent('<script>private-secret</script>'));
        assert.ok(!(await page.content()).includes('private-secret'));
        await context.close();
        console.log('PASS: Helmet/native form with real session, trusted Origin, 303 then GET, expired CSRF, foreign/null Origin rejection, validation failure, no credential echo.');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(temp, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
