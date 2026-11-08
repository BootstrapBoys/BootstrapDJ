import { EmbedBuilder } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

const PAGE_SIZE = 10;

export default class GuildList extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'guildlist',
            description: {
                content: 'List all guilds the bot is in',
                examples: ['guildlist'],
                usage: 'guildlist',
            },
            category: 'dev',
            aliases: ['glt'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: true,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: false,
            options: [],
        });
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const rows = [...client.guilds.cache.values()].map(guild => `${guild.name} (${guild.id})`);
        const chunks = client.utils.chunk(rows, PAGE_SIZE);
        const pages: EmbedBuilder[] = (chunks.length ? chunks : [[]]).map((chunk, index, all) =>
            client
                .embed()
                .setColor(client.color.main)
                .setDescription(chunk.join('\n'))
                .setFooter({ text: `Page ${index + 1} of ${all.length}` })
        );
        return await client.utils.paginate(ctx, pages);
    }
}
