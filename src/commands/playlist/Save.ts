import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class Save extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'save',
            description: { content: 'Saves the current queue to a playlist', usage: 'save <name>', examples: ['save roadtrip'] },
            category: 'music',
            aliases: ['savequeue'],
            cooldown: 5,
            args: true,
            player: { voice: true, dj: false, active: true, djPerm: null },
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
            slashCommand: true,
            options: [
                {
                    name: 'name',
                    description: 'Playlist name',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        const author = ctx.author;
        if (!guild || !author) return;
        const name = args.join(' ').trim();
        if (!name) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Give the playlist a name.')],
            });
        }
        if (name.length > 50) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Playlist names can be at most 50 characters.')],
            });
        }
        const player = client.queue.get(guild.id);
        if (!player?.current) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Nothing is playing right now.')],
            });
        }
        const tracks = [player.current, ...player.queue];
        let added = 0;
        for (const track of tracks) {
            if (await client.db.addSong(author.id, name, track)) added++;
        }
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(`Saved **${added}** track${added === 1 ? '' : 's'} to playlist **${name}**.`),
            ],
        });
    }
}
