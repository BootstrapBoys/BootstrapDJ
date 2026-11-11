import type { Context } from '../core/index.js';

import { translate } from './i18n.js';

type TranslationContext = Pick<Context, 'locale'> | { locale?: string };

/**
 * Translate from command code without requiring every test fake to implement
 * Context#t. Real contexts always carry the resolved guild locale.
 */
export function tr(
    ctx: TranslationContext,
    key: string,
    variables: Record<string, string | number> = {}
): string {
    return translate(key, ctx.locale, variables);
}
