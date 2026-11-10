import test from 'node:test';
import assert from 'node:assert/strict';

import { renderDashboard } from '../dist/dashboard/page.js';

const html = renderDashboard(true);

test('dashboard exposes a hidden disconnect control beside the listen control', () => {
    const disconnect = html.match(/<button[^>]*id="disconnect-btn"[^>]*>/);
    assert.ok(disconnect, 'disconnect button is rendered');
    assert.match(disconnect[0], /style="display:none"/);
    assert.match(disconnect[0], /aria-label="Disconnect dashboard audio"/);
    assert.ok(
        html.indexOf('id="listen-btn"') < html.indexOf('id="disconnect-btn"'),
        'disconnect sits after listen'
    );
});

test('disconnect is only shown while the browser tap is active', () => {
    assert.match(html, /disconnectButton\.style\.display = audio\.status === 'off' \? 'none' : ''/);
    assert.match(html, /disconnectButton\.addEventListener\('click', stopAudio\)/);
});

test('the disconnect icon is stroked instead of relying on fill', () => {
    assert.match(html, /\.disconnect-btn svg \{[^}]*fill: none;[^}]*stroke: currentColor;/s);
});
