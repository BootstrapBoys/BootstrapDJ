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
startDashboard(host);
