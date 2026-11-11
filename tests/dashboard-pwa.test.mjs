import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PWA_ICONS, PWA_MANIFEST, PWA_SERVICE_WORKER } from '../dist/dashboard/pwa.js';
import { renderDashboard, renderLoginPage } from '../dist/dashboard/page.js';

test('the PWA manifest is installable and uses the public icon routes', () => {
    const manifest = JSON.parse(PWA_MANIFEST);
    assert.equal(manifest.name, 'BootstrapDJ');
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.scope, '/');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.theme_color, '#111318');
    assert.deepEqual(
        manifest.icons.map(icon => [icon.src, icon.sizes, icon.type]),
        [
            ['/icons/icon-192.png', '192x192', 'image/png'],
            ['/icons/icon-512.png', '512x512', 'image/png'],
        ]
    );
});

test('the service worker precaches only public PWA assets', () => {
    assert.match(PWA_SERVICE_WORKER, /addEventListener\('fetch'/);
    assert.match(PWA_SERVICE_WORKER, /manifest\.webmanifest/);
    assert.match(PWA_SERVICE_WORKER, /url\.pathname\.startsWith\('\/api\/'\)/);
    assert.match(PWA_SERVICE_WORKER, /url\.pathname\.startsWith\('\/auth\/'\)/);
    assert.doesNotMatch(PWA_SERVICE_WORKER, /cache\.addAll\([^)]*['"]\/['"]/);
});

test('PWA icons are valid PNG data', () => {
    for (const [path, encoded] of Object.entries(PWA_ICONS)) {
        assert.ok(encoded.length > 100, `${path} has data`);
        assert.equal(
            Buffer.from(encoded, 'base64').subarray(0, 8).toString('hex'),
            '89504e470d0a1a0a'
        );
    }
});

test('both dashboard pages advertise the PWA shell', () => {
    for (const html of [renderDashboard(true), renderLoginPage()]) {
        assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
        assert.match(html, /name="theme-color"/);
        assert.match(html, /rel="apple-touch-icon"/);
    }
    const dashboard = renderDashboard(true);
    assert.match(dashboard, /id="install-btn"/);
    assert.ok(
        dashboard.indexOf('id="install-btn"') > dashboard.indexOf('<footer>'),
        'install button belongs in the footer'
    );
    assert.match(dashboard, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
    assert.match(dashboard, /const POLL_MS = 2000/);
    assert.match(dashboard, /document\.visibilityState !== 'visible'/);
    assert.match(dashboard, /document\.addEventListener\('visibilitychange'/);
});
