import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

function latencyBlock(milliseconds: number): string {
    return `\`\`\`ini\n[ ${milliseconds}ms ]\n\`\`\``;
}

export default class Ping extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'ping',
            description: { content: "Shows the bot's ping", examples: ['ping'], usage: 'ping' },
            category: 'general',
            aliases: ['pong'],
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
        const author = ctx.author;
        const self = client.user;
        if (!author || !self) return;

        const probe = await ctx.sendDeferMessage(tr(ctx, 'longtail:tools.pingDefer'));
        const roundTrip = probe.createdTimestamp - ctx.createdTimestamp;

        const embed = client
            .embed()
            .setAuthor({
                name: tr(ctx, 'longtail:tools.pingPong'),
                iconURL: self.displayAvatarURL(),
            })
            .setColor(client.color.main)
            .addFields(
                {
                    name: tr(ctx, 'longtail:tools.pingBotLatency'),
                    value: latencyBlock(roundTrip),
                    inline: true,
                },
                {
                    name: tr(ctx, 'longtail:tools.pingApiLatency'),
                    value: latencyBlock(Math.round(client.ws.ping)),
                    inline: true,
                }
            )
            .setFooter({
                text: tr(ctx, 'longtail:tools.pingFooter', { user: author.tag }),
                iconURL: author.avatarURL({}) ?? undefined,
            })
            .setTimestamp();

        return await ctx.editMessage({ content: '', embeds: [embed] });
    }
}
