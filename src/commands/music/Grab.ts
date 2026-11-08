import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class Grab extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'grab',
            description: {
                content: 'Grabs the current playing song',
                examples: ['grab'],
                usage: 'grab',
            },
            category: 'music',
            aliases: [],
            cooldown: 3,
            args: false,
            player: {
                voice: false,
                dj: false,
                active: true,
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
    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const embed = client.embed().setColor(client.color.main);
        const guild = ctx.guild;
        const author = ctx.author;
        if (!guild || !author) return;
        const player = client.queue.get(guild.id);
        if (!player)
            return await ctx.sendMessage({
                embeds: [
                    this.client
                        .embed()
                        .setColor(this.client.color.red)
                        .setDescription('There is no music playing in this server.'),
                ],
            });
        const song = player.current;
        if (!song)
            return await ctx.sendMessage({
                embeds: [
                    embed.setColor(client.color.red).setDescription(`Nothing playing right now`),
                ],
            });

        try {
            const dm = client
                .embed()
                .setTitle(`**${song.info.title}**`)
                .setURL(song.info.uri ?? null)
                .setThumbnail(song.info.artworkUrl ?? null)
                .setDescription(
                    `**Duration:** ${
                        song.info.isStream ? 'LIVE' : client.utils.formatTime(song.info.length)
                    }\n**Requested by:** ${song.info.requester}\n**Link:** [Click here](${
                        song.info.uri
                    })`
                )
                .setColor(client.color.main);
            await author.send({ embeds: [dm] });
            return await ctx.sendMessage({
                embeds: [embed.setDescription(`**I sent you a DM.**`).setColor(client.color.green)],
            });
        } catch {
            return await ctx.sendMessage({
                embeds: [
                    embed
                        .setDescription(`**I couldn't send you a DM.**`)
                        .setColor(client.color.red),
                ],
            });
        }
    }
}
