import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';
import { requesterFilter } from '../../lib/QueueTools.js';

export default class RemoveUser extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'removeuser',
            description: {
                content: 'Removes a user’s queued tracks',
                usage: 'removeuser <user>',
                examples: ['removeuser @user'],
            },
            category: 'music',
            aliases: ['ru'],
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
                    name: 'user',
                    description: 'User whose tracks should be removed',
                    type: ApplicationCommandOptionType.User,
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
                        .setDescription(tr(ctx, 'longtail:music.removeUser.empty')),
                ],
            });
        }
        const target = ctx.isInteraction
            ? ctx.interaction?.options.getUser('user')
            : await client.users.fetch(String(args[0]).replace(/[<@!>]/g, '')).catch(() => null);
        if (!target) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.removeUser.unresolved')),
                ],
            });
        }
        const before = player.queue.length;
        player.queue = player.queue.filter(track => !requesterFilter([track], target.id).length);
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
                                      ? 'longtail:music.removeUser.removedOne'
                                      : 'longtail:music.removeUser.removedMany',
                                  { count: removed, user: target.username }
                              )
                            : tr(ctx, 'longtail:music.removeUser.none', { user: target.username })
                    ),
            ],
        });
    }
}
