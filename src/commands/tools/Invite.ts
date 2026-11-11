import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

/** Channel management, messages, embeds, history, voice, and slash commands. */
const INVITE_PERMISSIONS = 4298501200;
const ISSUES_URL = 'https://github.com/BootstrapBoys/BootstrapDJ/issues';

function inviteUrl(clientId: string): string {
    const scope = 'bot%20applications.commands';
    return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${INVITE_PERMISSIONS}&scope=${scope}`;
}

function linkButton(label: string, url: string): ButtonBuilder {
    return new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);
}

export default class Invite extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'invite',
            description: {
                content: "Sends the bot's invite link",
                examples: ['invite'],
                usage: 'invite',
            },
            category: 'info',
            aliases: ['inv'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [],
        });
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const clientId = client.user?.id ?? client.config.clientId;
        if (!clientId) {
            client.logger.error('[invite] no application id available to build an invite link');
            return await ctx.sendMessage(tr(ctx, 'longtail:tools.inviteUnavailable'));
        }

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            linkButton(tr(ctx, 'longtail:tools.inviteButton'), inviteUrl(clientId)),
            linkButton(tr(ctx, 'longtail:tools.issuesButton'), ISSUES_URL)
        );

        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(tr(ctx, 'longtail:tools.inviteDescription')),
            ],
            components: [row],
        });
    }
}
