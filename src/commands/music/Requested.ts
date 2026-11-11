import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

export default class Requested extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'requested',
            description: {
                content: 'Shows queued tracks requested by a user',
                usage: 'requested [user]',
                examples: ['requested', 'requested @user'],
            },
            category: 'music',
            aliases: ['req'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [
                {
                    name: 'user',
                    description: 'Whose requests to show (defaults to you)',
                    type: ApplicationCommandOptionType.User,
                    required: false,
                },
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, _args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const player = client.queue.get(guild.id);
        if (!player?.current) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:music.requested.nothingPlaying')),
                ],
            });
        }
        const target = ctx.isInteraction
            ? (ctx.interaction?.options.getUser('user') ?? ctx.author)
            : (ctx.message?.mentions.users.first() ?? ctx.author);
        if (!target) return;
        const tracks = player.queue.filter(track => {
            const requester = track.info.requester as { id?: string } | undefined;
            return requester?.id === target.id;
        });
        if (!tracks.length) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setDescription(
                            tr(ctx, 'longtail:music.requested.none', { user: target.username })
                        ),
                ],
            });
        }
        const lines = tracks
            .slice(0, 15)
            .map((track, index) => `**${index + 1}.** [${track.info.title}](${track.info.uri})`);
        const suffix =
            tracks.length > 15
                ? `\n${tr(ctx, 'longtail:music.requested.more', { count: tracks.length - 15 })}`
                : '';
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle(tr(ctx, 'longtail:music.requested.title', { user: target.username }))
                    .setDescription(`${lines.join('\n')}${suffix}`.slice(0, 4096)),
            ],
        });
    }
}
