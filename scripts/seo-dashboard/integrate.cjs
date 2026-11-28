// Add two well-defined integration points without executing application code.
// All other bytes, custom routes, imports and sidebar entries remain unchanged.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
function fail(message) {
    throw new Error(message);
}
function router(source, ts) {
    const file = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    if (file.parseDiagnostics.length) fail('Router TypeScript has syntax errors');
    const imports = file.statements.filter(ts.isImportDeclaration);
    const names = new Set();
    const visit = (n) => {
        if (ts.isIdentifier(n)) names.add(n.text);
        ts.forEachChild(n, visit);
    };
    visit(file);
    const defaultExport = file.statements.filter((n) => ts.isExportAssignment(n) && !n.isExportEquals);
    if (defaultExport.length !== 1 || !ts.isIdentifier(defaultExport[0].expression))
        fail('Expected one exported Express router identifier');
    const target = defaultExport[0].expression.text;
    let guard, routerFactory, expressName;
    const seoImports = [];
    for (const item of imports) {
        if (!ts.isStringLiteral(item.moduleSpecifier)) continue;
        const module = item.moduleSpecifier.text;
        const bindings = item.importClause?.namedBindings;
        if (module === 'express') {
            expressName = item.importClause?.name?.text;
            if (bindings && ts.isNamespaceImport(bindings)) expressName = bindings.name.text;
            if (bindings && ts.isNamedImports(bindings))
                for (const element of bindings.elements)
                    if ((element.propertyName || element.name).text === 'Router') routerFactory = element.name.text;
        }
        if (
            ['@/api/auth/auth.middleware', './auth/auth.middleware'].includes(module) &&
            bindings &&
            ts.isNamedImports(bindings)
        )
            for (const element of bindings.elements)
                if ((element.propertyName || element.name).text === 'checkSessionAndSetUser') guard = element.name.text;
        if (['./seo/seo.route', '@/api/seo/seo.route'].includes(module)) {
            if (!item.importClause?.name || item.importClause.isTypeOnly)
                fail('SEO import must be a default runtime import');
            seoImports.push(item.importClause.name.text);
        }
    }
    if (!guard) fail('Expected the existing authenticated session guard import');
    const declarations = file.statements
        .filter(ts.isVariableStatement)
        .flatMap((n) => [...n.declarationList.declarations]);
    const declaration = declarations.filter((n) => ts.isIdentifier(n.name) && n.name.text === target);
    const call = declaration[0]?.initializer;
    const factory =
        call &&
        ts.isCallExpression(call) &&
        ((ts.isIdentifier(call.expression) && call.expression.text === routerFactory) ||
            (ts.isPropertyAccessExpression(call.expression) &&
                ts.isIdentifier(call.expression.expression) &&
                call.expression.expression.text === expressName &&
                call.expression.name.text === 'Router'));
    if (declaration.length !== 1 || !factory) fail('Exported object is not an unambiguous Express Router');
    if (seoImports.length > 1) fail('Duplicate SEO imports');
    let alias = seoImports[0] || 'seo';
    if (!seoImports.length)
        for (let suffix = 0; names.has(alias); suffix++) alias = 'seoDashboardRouter' + (suffix || '');
    const mounts = file.statements
        .filter(ts.isExpressionStatement)
        .map((n) => n.expression)
        .filter(
            (n) =>
                ts.isCallExpression(n) &&
                ts.isPropertyAccessExpression(n.expression) &&
                ts.isIdentifier(n.expression.expression) &&
                n.expression.expression.text === target &&
                n.expression.name.text === 'use' &&
                n.arguments[0] &&
                ts.isStringLiteralLike(n.arguments[0]) &&
                ['/seo', '/seo/'].includes(n.arguments[0].text),
        );
    if (mounts.length > 1) fail('Duplicate /seo route mounts');
    if (mounts.length) {
        const args = mounts[0].arguments;
        const guardAt = args.findIndex((n) => ts.isIdentifier(n) && n.text === guard);
        const handlerAt = args.findIndex((n) => ts.isIdentifier(n) && n.text === alias);
        if (!seoImports.length || guardAt < 1 || handlerAt <= guardAt)
            fail('/seo is already used by another or unguarded handler');
        return source;
    }
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    const edits = [
        { at: defaultExport[0].getStart(file), value: `${target}.use('/seo', ${guard}, ${alias});${eol}${eol}` },
    ];
    if (!seoImports.length) {
        const last = imports.filter((item) => item.end <= declaration[0].getStart(file)).at(-1);
        if (!last) fail('Router has no imports');
        const lineEnd = source.indexOf('\n', last.end);
        const tail = source.slice(last.end, lineEnd < 0 ? source.length : lineEnd);
        // Minified files can have executable statements on the import's line.
        // Keep the new import before those statements in CommonJS output, while
        // preserving ordinary trailing comments on formatted import lines.
        const trailingOnly = /^[\t ]*(?:\/\/[^\r\n]*|\/\*.*?\*\/[\t ]*)?\r?$/.test(tail) && !tail.includes('@ts-');
        const at = lineEnd >= 0 && trailingOnly ? lineEnd + 1 : last.end;
        edits.push({ at, value: (at === last.end ? eol : '') + `import ${alias} from './seo/seo.route';${eol}` });
    }
    for (const edit of edits.sort((a, b) => b.at - a.at))
        source = source.slice(0, edit.at) + edit.value + source.slice(edit.at);
    const parsed = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    if (parsed.parseDiagnostics.length) fail('Generated router failed syntax validation');
    return source;
}
function attrs(tag) {
    return Object.fromEntries(
        [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => [m[1].toLowerCase(), m[2] ?? m[3]]),
    );
}
function sidebar(source, ejs) {
    try {
        ejs.compile(source, { filename: 'sidebar.ejs' });
    } catch {
        fail('Sidebar EJS has syntax errors');
    }
    const tokens = [
        ...source.matchAll(/<%[\s\S]*?%>|<!--[\s\S]*?-->|<\/?[a-z][\w:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi),
    ];
    const stack = [],
        candidates = [];
    for (const token of tokens) {
        if (/^<%|^<!--/.test(token[0])) continue;
        if (/^<ul\b/i.test(token[0])) {
            const a = attrs(token[0]),
                classes = (a.class || '').split(/\s+/);
            stack.push({
                start: token.index,
                target: a.id === 'accordionSidebar' || (classes.includes('sidebar') && classes.includes('navbar-nav')),
            });
        } else if (/^<\/ul\s*>/i.test(token[0])) {
            const open = stack.pop();
            if (!open) fail('Sidebar list tags are unbalanced');
            if (open.target) candidates.push({ start: open.start, end: token.index });
        }
    }
    if (stack.length || candidates.length !== 1) fail('Expected one balanced sidebar navigation list');
    const area = candidates[0],
        content = source.slice(area.start, area.end);
    const anchors = tokens.filter(
        (t) =>
            t.index >= area.start &&
            t.index < area.end &&
            /^<a\b/i.test(t[0]) &&
            ['/seo', '/seo/'].includes(attrs(t[0]).href),
    );
    const dynamicEntry = [...content.matchAll(/<%(?!#)[\s\S]*?%>/g)].some((m) =>
        /(?:\burl|["']url["'])\s*:\s*(['"])\/seo\/?\1/.test(m[0]),
    );
    if (anchors.length > 1) fail('Duplicate SEO navigation links');
    if (anchors.length || dynamicEntry) return source;
    const eol = source.includes('\r\n') ? '\r\n' : '\n';
    const link = `<li class="nav-item"><a class="nav-link" href="/seo"><i class="fas fa-search"></i><span>SEO · Индексация</span></a></li>`;
    const after = source.slice(0, area.end) + '    ' + link + eol + source.slice(area.end);
    try {
        ejs.compile(after, { filename: 'sidebar.ejs' });
    } catch {
        fail('Generated sidebar failed EJS syntax validation');
    }
    return after;
}
module.exports = { router, sidebar };
if (require.main === module) {
    try {
        const root = process.argv[2],
            data = JSON.parse(fs.readFileSync(0, 'utf8'));
        if (typeof data.source !== 'string') fail('Missing source');
        let source;
        if (data.kind === 'router')
            source = router(data.source, require(path.join(root, 'node_modules/typescript/lib/typescript.js')));
        else if (data.kind === 'sidebar') source = sidebar(data.source, require(path.join(root, 'node_modules/ejs')));
        else fail('Unknown integration point');
        process.stdout.write(JSON.stringify({ source }));
    } catch (e) {
        process.stdout.write(JSON.stringify({ error: e.message }));
        process.exitCode = 1;
    }
}
