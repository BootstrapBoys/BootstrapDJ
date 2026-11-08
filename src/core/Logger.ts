import signale, { type SignaleOptions } from 'signale';

const { Signale } = signale;

type LabelSpec = NonNullable<NonNullable<SignaleOptions['types']>['info']>;

function label(badge: string, color: string, text: string): LabelSpec {
    return { badge, color, label: text };
}

/** One vocabulary for every module: label, badge, and terminal colour. */
const VOCABULARY: SignaleOptions['types'] = {
    info: label('ℹ', 'blue', 'info'),
    warn: label('⚠', 'yellow', 'warn'),
    error: label('✖', 'red', 'error'),
    debug: label('🐛', 'magenta', 'debug'),
    success: label('✔', 'green', 'success'),
    log: label('📝', 'white', 'log'),
    pause: label('⏸', 'yellow', 'pause'),
    start: label('▶', 'green', 'start'),
};

/**
 * Process logger for the bot.
 *
 * Signale owns terminal formatting; this class owns the labels so every module
 * emits the same visual vocabulary. New log types belong in VOCABULARY rather
 * than in a bare console call.
 */
export default class Logger extends Signale {
    public constructor() {
        const options: SignaleOptions = {
            disabled: false,
            interactive: false,
            logLevel: 'info',
            scope: 'BootstrapDJ',
            types: { ...VOCABULARY },
        };
        super(options);
    }
}
