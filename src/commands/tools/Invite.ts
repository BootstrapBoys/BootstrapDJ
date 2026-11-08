import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

/** Channel management, messages, embeds, history, voice, and slash commands. */
const INVITE_PERMISSIONS = 4298501200;
const ISSUES_URL = 'https://github.com/zebz213/BootstrapDJ/issues';

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
            return await ctx.sendMessage(
                'Sorry, my invite link is not available at this time. Please tell the bot developer to check their console.'
            );
        }

        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            linkButton('Invite', inviteUrl(clientId)),
            linkButton('Issues', ISSUES_URL)
        );

        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(
                        'You can invite me by clicking the button below. For bugs or feature requests, open an issue on GitHub.'
                    ),
            ],
            components: [row],
        });
    }
}
