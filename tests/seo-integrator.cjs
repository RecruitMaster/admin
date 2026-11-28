const { test } = require('node:test'),
    assert = require('node:assert/strict'),
    fs = require('node:fs'),
    { execFileSync } = require('node:child_process');
const ts = require('typescript'),
    ejs = require('ejs');
const { router, sidebar } = require('../scripts/seo-dashboard/integrate.cjs');
const base = (file) => execFileSync('git', ['show', 'ab5e19e:' + file], { encoding: 'utf8' });
const index = base('src/api/index.ts'),
    menu = base('src/views/partials/sidebar.ejs');
test('router integration accepts deployment formatting, quote and line-ending variants', () => {
    for (const source of [
        index,
        index.replaceAll("'", '"').replaceAll('    ', '  '),
        index.replaceAll('\n', '\r\n'),
        index.replace('const router: Router', 'const router'),
        index.replace(/\s+/g, ' '),
    ]) {
        const after = router(source, ts);
        assert.match(after, /\.use\('\/seo', checkSessionAndSetUser, seo\)/);
        assert.equal(router(after, ts), after);
        assert.ok(
            after.includes("router.use('/users', checkSessionAndSetUser, users)") ||
                after.includes('router.use("/users", checkSessionAndSetUser, users)'),
        );
    }
});
test('minified router imports initialize before the new mount in real CommonJS execution', () => {
    const after = router(index.replace(/\s+/g, ' '), ts),
        calls = [];
    const r = { get: () => {}, use: (...args) => calls.push(args) },
        handler = () => {},
        guard = () => {};
    const code = ts.transpileModule(after, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const stub = (name) =>
        name === 'express'
            ? { Router: () => r }
            : name.includes('auth.middleware')
              ? { checkSessionAndSetUser: guard }
              : { __esModule: true, default: handler };
    new Function('require', 'exports', code)(stub, {});
    const mount = calls.find((a) => a[0] === '/seo');
    assert.equal(mount[1], guard);
    assert.equal(mount[2], handler);
});
test('router integration preserves unrelated imports, routes, inline comments and identities', () => {
    const source = index
        .replace('import setting', "import extra from './extra';\nimport setting")
        .replace(
            'export default router;',
            "router.use('/reports', checkSessionAndSetUser, extra);\n// UTF-8: отчёты 🙂\nexport default router;",
        )
        .replace(
            "import setting from '@/api/settings/settings.route';",
            "import setting from '@/api/settings/settings.route'; // keep this comment",
        );
    const after = router(source, ts);
    assert.ok(after.includes("router.use('/reports', checkSessionAndSetUser, extra);"));
    assert.ok(after.includes('// UTF-8: отчёты 🙂'));
    assert.ok(after.includes("import setting from '@/api/settings/settings.route'; // keep this comment"));
    assert.equal(router(after, ts), after);
});
test('router and guard aliases are resolved through real TypeScript imports', () => {
    const source = index
        .replace('{ Router }', '{ Router as MakeRouter }')
        .replace('router: Router = Router()', 'routes: ReturnType<typeof MakeRouter> = MakeRouter()')
        .replace(/\brouter\b/g, 'routes')
        .replace('{ checkSessionAndSetUser }', '{ checkSessionAndSetUser as requireSession }')
        .replace(/, checkSessionAndSetUser,/g, ', requireSession,');
    const after = router(source, ts);
    assert.match(after, /routes\.use\('\/seo', requireSession, seo\)/);
    assert.equal(router(after, ts), after);
});
test('existing protected SEO route and sidebar links remain exactly unchanged', () => {
    const current = fs.readFileSync('src/api/index.ts', 'utf8'),
        currentMenu = fs.readFileSync('src/views/partials/sidebar.ejs', 'utf8');
    assert.equal(router(current, ts), current);
    assert.equal(sidebar(currentMenu, ejs), currentMenu);
});
test('an existing symbol called seo receives a collision-free import alias', () => {
    const source = index.replace(
        'export default router;',
        'const seo = "existing custom value";\nexport default router;',
    );
    const after = router(source, ts);
    assert.match(after, /import seoDashboardRouter from/);
    assert.ok(after.includes('const seo = "existing custom value";'));
    assert.equal(router(after, ts), after);
});
test('ambiguous, unguarded or non-Router integration targets fail without rewrites', () => {
    for (const source of [
        index.replace("router.use('/users'", "router.use('/seo'"),
        index.replace('{ checkSessionAndSetUser }', '{ anotherGuard }'),
        index.replace('= Router()', '= getUnknownRouter()'),
        index + '\nexport default other;',
    ])
        assert.throws(() => router(source, ts));
});
test('sidebar integration handles minification, quotes, changed footer and extra nested lists', () => {
    const variants = [
        menu,
        menu.replace(/>\s+</g, '><'),
        menu.replaceAll('"', "'"),
        menu.replace('id="sidebarToggle"', 'id="customToggle"'),
        menu.replace('</ul>', '<li><ul><li>Extra unrelated navigation</li></ul></li></ul>'),
    ];
    for (const source of variants) {
        const after = sidebar(source, ejs);
        assert.match(after, /href="\/seo"/);
        assert.equal(sidebar(after, ejs), after);
        assert.ok(after.includes('customToggle') === source.includes('customToggle'));
    }
});
test('sidebar does not duplicate a custom data-driven SEO entry', () => {
    const source = menu.replace(
        "{ tag: 'users'",
        "{ tag:'seo', name:'SEO', items:[{url:'/seo',name:'Search'}]}, { tag: 'users'",
    );
    assert.equal(sidebar(source, ejs), source);
});
test('invalid/ambiguous sidebar structures are rejected instead of edited', () => {
    for (const source of [
        menu + menu,
        menu.replace('id="accordionSidebar"', 'id="other"').replace('sidebar sidebar-dark', 'other sidebar-dark'),
        menu.replace('</ul>', ''),
        '<% if (broken { %><ul id="accordionSidebar"></ul>',
    ])
        assert.throws(() => sidebar(source, ejs));
});
test('actual installer helper protocol works with only the admin dependencies', () => {
    const out = execFileSync(process.execPath, ['scripts/seo-dashboard/integrate.cjs', process.cwd()], {
        input: JSON.stringify({ kind: 'router', source: index }),
        encoding: 'utf8',
    });
    assert.equal(JSON.parse(out).source, router(index, ts));
});
