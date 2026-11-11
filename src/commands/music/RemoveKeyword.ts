import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

export default class RemoveKeyword extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'removekeyword',
            description: {
                content: 'Removes queued tracks matching a keyword',
                usage: 'removekeyword <keyword>',
                examples: ['removekeyword live'],
            },
            category: 'music',
            aliases: ['rk'],
            cooldown: 3,
            args: true,
            player: { voice: true, dj: true, active: true, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [
                {
                    name: 'keyword',
                    description: 'Text to match against title or author',
                    type: ApplicationCommandOptionType.String,
                    required: true,
                },
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const player = client.queue.get(guild.id);
        if (!player?.current || !player.queue.length) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.removeKeyword.empty')),
                ],
            });
        }
        const keyword = args.join(' ').trim().toLowerCase();
        if (!keyword) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.removeKeyword.missing')),
                ],
            });
        }
        const before = player.queue.length;
        player.queue = player.queue.filter(track => {
            const haystack = `${track.info?.title ?? ''} ${track.info?.author ?? ''}`.toLowerCase();
            return !haystack.includes(keyword);
        });
        const removed = before - player.queue.length;
        await player.persist();
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(
                        removed
                            ? tr(
                                  ctx,
                                  removed === 1
                                      ? 'longtail:music.removeKeyword.removedOne'
                                      : 'longtail:music.removeKeyword.removedMany',
                                  { count: removed, keyword }
                              )
                            : tr(ctx, 'longtail:music.removeKeyword.none', { keyword })
                    ),
            ],
        });
    }
}
