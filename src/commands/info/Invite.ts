import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class Invite extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'invite',
            description: {
                content: 'Sends the bot\'s invite link',
                examples: ['invite'],
                usage: 'invite',
            },
            category: 'info',
            aliases: ['inv'],
            cooldown: 3,
            args: false,
            player: {
                voice: false,
                dj: false,
                active: false,
                djPerm: null,
            },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [],
        });
    }
    public async run(_client: BootstrapClient, ctx: Context): Promise<unknown> {
        const clientId = this.client.user?.id ?? this.client.config.clientId;
        if (!clientId) {
            this.client.logger.error('[invite] no application id available to build an invite link');
            return await ctx.sendMessage(
                'Sorry, my invite link is not available at this time. Please tell the bot developer to check their console.'
            );
        }

        const embed = this.client.embed();
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('Invite')
                .setStyle(ButtonStyle.Link)
                .setURL(
                    `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=4298238976&scope=bot%20applications.commands`
                ),
            new ButtonBuilder()
                .setLabel('Issues')
                .setStyle(ButtonStyle.Link)
                .setURL('https://github.com/zebz213/BootstrapDJ/issues')
        );

        return await ctx.sendMessage({
            embeds: [
                embed
                    .setColor(this.client.color.main)
                    .setDescription(
                        `You can invite me by clicking the button below. For bugs or feature requests, open an issue on GitHub.`
                    ),
            ],
            components: [row],
        });
    }
}
