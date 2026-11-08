import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class Ping extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'ping',
            description: { content: 'Shows the bot\'s ping', examples: ['ping'], usage: 'ping' },
            category: 'general',
            aliases: ['pong'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
            slashCommand: true,
            options: [],
        });
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const author = ctx.author;
        const me = client.user;
        if (!author || !me) return;
        const message = await ctx.sendDeferMessage('Pinging...');
        const embed = client
            .embed()
            .setAuthor({ name: 'Pong', iconURL: me.displayAvatarURL() })
            .setColor(client.color.main)
            .addFields(
                { name: 'Bot Latency', value: `\`\`\`ini\n[ ${message.createdTimestamp - ctx.createdTimestamp}ms ]\n\`\`\``, inline: true },
                { name: 'API Latency', value: `\`\`\`ini\n[ ${Math.round(client.ws.ping)}ms ]\n\`\`\``, inline: true }
            )
            .setFooter({ text: `Requested by ${author.tag}`, iconURL: author.avatarURL({}) ?? undefined })
            .setTimestamp();
        return await ctx.editMessage({ content: '', embeds: [embed] });
    }
}
