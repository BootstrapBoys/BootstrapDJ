import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

const NAME_LIMIT = 50;

export default class Save extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'save',
            description: {
                content: 'Saves the current queue to a playlist',
                usage: 'save <name>',
                examples: ['save roadtrip'],
            },
            category: 'music',
            aliases: ['savequeue'],
            cooldown: 5,
            args: true,
            player: { voice: true, dj: false, active: true, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: false,
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

    private copy(
        ctx: Context,
        key: string,
        variables: Record<string, string | number> = {}
    ): string {
        return tr(ctx, `longtail:manage.save.${key}`, variables);
    }

    private fail(client: BootstrapClient, ctx: Context, text: string): Promise<unknown> {
        return ctx.sendMessage({
            embeds: [client.embed().setColor(client.color.red).setDescription(text)],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        const author = ctx.author;
        if (!guild || !author) return;

        const name = args.join(' ').trim();
        if (!name) return await this.fail(client, ctx, this.copy(ctx, 'nameRequired'));
        if (name.length > NAME_LIMIT) {
            return await this.fail(client, ctx, this.copy(ctx, 'tooLong'));
        }

        const player = client.queue.get(guild.id);
        if (!player?.current) return await this.fail(client, ctx, this.copy(ctx, 'nothingPlaying'));

        let added = 0;
        for (const track of [player.current, ...player.queue]) {
            if (await client.db.addSong(author.id, name, track)) added += 1;
        }
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(
                        this.copy(ctx, added === 1 ? 'saved' : 'savedPlural', {
                            count: added,
                            name,
                        })
                    ),
            ],
        });
    }
}
