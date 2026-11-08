import signale, { type SignaleOptions } from 'signale';

const { Signale } = signale;

const baseOptions: SignaleOptions = {
    disabled: false,
    interactive: false,
    logLevel: 'info',
    scope: 'BootstrapDJ',
};

/**
 * Process logger for the bot.
 *
 * Signale owns terminal formatting; this class owns the labels so every module
 * emits the same visual vocabulary. New log types should be added here rather
 * than falling back to console methods.
 */
export default class Logger extends Signale {
    public constructor() {
        super({
            ...baseOptions,
            types: {
                info: { badge: 'ℹ', color: 'blue', label: 'info' },
                warn: { badge: '⚠', color: 'yellow', label: 'warn' },
                error: { badge: '✖', color: 'red', label: 'error' },
                debug: { badge: '🐛', color: 'magenta', label: 'debug' },
                success: { badge: '✔', color: 'green', label: 'success' },
                log: { badge: '📝', color: 'white', label: 'log' },
                pause: { badge: '⏸', color: 'yellow', label: 'pause' },
                start: { badge: '▶', color: 'green', label: 'start' },
            },
        });
    }
}
