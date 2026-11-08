/**
 * Public session API. Restore lives in `core/player/SessionRestorer` and the
 * fleet lease watchdog in `core/player/SessionLease`; this module only keeps
 * the established import path for callers and tests.
 */
export {
    hasListeners,
    isRestorable,
    restoreSession,
    restoreSessions,
    waitForListeners,
    waitForNode,
} from '../core/player/SessionRestorer.js';
export { startSessionHandoffs } from '../core/player/SessionLease.js';
