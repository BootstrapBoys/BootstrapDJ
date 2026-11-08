import { EmbedBuilder } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class GuildList extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'guildlist',
            description: { content: 'List all guilds the bot is in', examples: ['guildlist'], usage: 'guildlist' },
            category: 'dev',
            aliases: ['glt'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: { dev: true, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
            slashCommand: false,
            options: [],
        });
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const names = client.guilds.cache.map(guild => `${guild.name} (${guild.id})`);
        const chunks = client.utils.chunk(names, 10);
        if (!chunks.length) chunks.push([]);
        const pages: EmbedBuilder[] = chunks.map((chunk, index) =>
            client
                .embed()
                .setColor(client.color.main)
                .setDescription(chunk.join('\n'))
                .setFooter({ text: `Page ${index + 1} of ${chunks.length}` })
        );
        return await client.utils.paginate(ctx, pages);
    }
}
