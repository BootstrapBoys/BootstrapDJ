import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class Ping extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'ping',
            description: {
                content: 'Shows the bot\'s ping',
                examples: ['ping'],
                usage: 'ping',
            },
            category: 'general',
            aliases: ['pong'],
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
    public async run(client: BootstrapClient, ctx: Context): Promise<any> {
        const author = ctx.author;
        const clientUser = client.user;
        if (!author || !clientUser) return;
        const msg = await ctx.sendDeferMessage('Pinging...');

        const embed = client
            .embed()
            .setAuthor({ name: 'Pong', iconURL: clientUser.displayAvatarURL() })
            .setColor(this.client.color.main)
            .addFields([
                {
                    name: 'Bot Latency',
                    value: `\`\`\`ini\n[ ${
                        msg.createdTimestamp - ctx.createdTimestamp
                    }ms ]\n\`\`\``,
                    inline: true,
                },
                {
                    name: 'API Latency',
                    value: `\`\`\`ini\n[ ${Math.round(ctx.client.ws.ping)}ms ]\n\`\`\``,
                    inline: true,
                },
            ])
            .setFooter({
                text: `Requested by ${author.tag}`,
                iconURL: author.avatarURL({}) ?? undefined,
            })
            .setTimestamp();
        return await ctx.editMessage({ content: '', embeds: [embed] });
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
