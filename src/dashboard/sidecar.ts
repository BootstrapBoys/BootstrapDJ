import config from '../config.js';
import { startDashboard } from './server.js';
import { RemoteDashboardHost } from './remoteHost.js';

if (config.dashboardMode !== 'sidecar') {
    console.error(
        '[dashboard] sidecar entry requires DASHBOARD_MODE=sidecar; use the embedded mode for DJBoot'
    );
    process.exit(1);
}
if (!config.dashboardControlPort) {
    console.error('[dashboard] DASHBOARD_CONTROL_PORT is required in sidecar mode');
    process.exit(1);
}
if (!config.dashboardControlSecret) {
    console.error('[dashboard] DASHBOARD_CONTROL_SECRET is required in sidecar mode');
    process.exit(1);
}

const host = new RemoteDashboardHost(config.dashboardControlPort, config.dashboardControlSecret);
// A sidecar restart closes every browser stream. Clear the bot's stale counts
// so the shared dashboard-idle cleanup can run if no one reconnects.
void host.resetDashboardAudio().catch(error => {
    host.logger.warn(
        `[dashboard] could not reset audio listener counts: ${
            error instanceof Error ? error.message : String(error)
        }`
    );
});
startDashboard(host);
