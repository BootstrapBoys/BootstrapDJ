import { EmbedBuilder } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class GuildList extends Command {
    constructor(client: BootstrapClient) {
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
            player: {
                voice: false,
                dj: false,
                active: false,
                djPerm: null,
            },
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
        const guilds = this.client.guilds.cache.map(g => `${g.name} (${g.id})`);

        const chunks = client.utils.chunk(guilds, 10);
        if (chunks.length === 0) chunks.push([]);
        const pages: EmbedBuilder[] = [];
        for (let i = 0; i < chunks.length; i++) {
            const embed = this.client
                .embed()
                .setColor(this.client.color.main)
                .setDescription(chunks[i].join('\n'))
                .setFooter({ text: `Page ${i + 1} of ${chunks.length}` });
            pages.push(embed);
        }
        return await client.utils.paginate(ctx, pages);
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
