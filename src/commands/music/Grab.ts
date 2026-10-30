import { Command, Context, Lavamusic } from '../../structures/index.js';

export default class Grab extends Command {
    constructor(client: Lavamusic) {
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
    public async run(client: Lavamusic, ctx: Context): Promise<any> {
        const embed = client.embed().setColor(client.color.main);
        const guild = ctx.guild;
        const author = ctx.author;
        if (!guild || !author) return;
        const player = client.queue.get(guild.id);
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
