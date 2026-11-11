import type Command from '../core/Command.js';

import { DEFAULT_LANGUAGE, localizedDescriptions, translate } from './i18n.js';

/**
 * Command metadata is global to the application, so Discord localizations come
 * from the catalogs rather than the guild locale. The English catalog remains
 * the source of truth; a missing entry leaves the constructor fallback intact.
 */
export function applyCommandMetadata(command: Command): void {
    const base = `commands:metadata.${command.name}`;
    const descriptionKey = `${base}.description`;
    const description = translate(descriptionKey, DEFAULT_LANGUAGE);
    if (description !== descriptionKey) {
        command.description.content = description;
        const localizations = localizedDescriptions(descriptionKey);
        if (Object.keys(localizations).length) {
            command.descriptionLocalizations = localizations;
        }
    }

    for (const option of command.options) {
        const key = `${base}.options.${option.name}`;
        const value = translate(key, DEFAULT_LANGUAGE);
        if (value !== key) option.description = value;
    }
}
