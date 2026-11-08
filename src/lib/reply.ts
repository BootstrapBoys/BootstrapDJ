import type { EmbedBuilder } from 'discord.js';

import type { BootstrapClient, Context } from '../core/index.js';

/** Colored one-line embed used by command replies. */
export function embedLine(
    client: BootstrapClient,
    description: string,
    color: number = client.color.main
): EmbedBuilder {
    return client.embed().setColor(color).setDescription(description);
}

export function failEmbed(client: BootstrapClient, description: string): EmbedBuilder {
    return embedLine(client, description, client.color.red);
}

/** Reply with a red status line. Returned promise resolves to the message. */
export function replyFail(client: BootstrapClient, ctx: Context, description: string): Promise<unknown> {
    return ctx.sendMessage({ embeds: [failEmbed(client, description)] });
}

/** Reply with a neutral status line. */
export function replyOk(client: BootstrapClient, ctx: Context, description: string): Promise<unknown> {
    return ctx.sendMessage({ embeds: [embedLine(client, description)] });
}

/** Reply with a green status line. */
export function replyDone(client: BootstrapClient, ctx: Context, description: string): Promise<unknown> {
    return ctx.sendMessage({ embeds: [embedLine(client, description, client.color.green)] });
}
