import { ApplicationCommandOptionType } from 'discord.js';

import { defineMusicCommand } from '../../lib/musicCommand.js';
import { tr } from '../../lib/i18nContext.js';
import { replyFail, replyOk } from '../../lib/reply.js';

const SEED_OPTIONS = ['seed', 'seed2', 'seed3'] as const;
const MAX_SEEDS = SEED_OPTIONS.length;

function seedsFromArguments(args: string[]): string[] {
    return args
        .join(' ')
        .split(',')
        .map(seed => seed.trim())
        .filter(Boolean)
        .slice(0, MAX_SEEDS);
}

export default defineMusicCommand({
    name: 'autoplay',
    description: {
        content: 'Toggles autoplay',
        examples: ['autoplay'],
        usage: 'autoplay',
    },
    aliases: ['ap'],
    args: false,
    // seedFrom() resolves through Lavalink and may create the player, which can
    // exceed Discord's three-second acknowledgement window.
    defer: true,
    // Autoplay is what starts playback when nothing is playing, so the
    // active-player guard must not run. DJ mode still applies.
    active: false,
    requirePlayer: false,
    clientPermissions: ['SendMessages', 'ViewChannel', 'EmbedLinks', 'Connect', 'Speak'],
    options: SEED_OPTIONS.map(name => ({
        name,
        description:
            name === 'seed'
                ? 'First artist or song'
                : `${name === 'seed2' ? 'Second' : 'Third'} artist or song (optional)`,
        type: ApplicationCommandOptionType.String,
        required: false,
    })),
    run: async ({ client, ctx, player: existing, args }) => {
        const guild = ctx.guild;
        if (!guild) return;

        const seeds = ctx.isInteraction
            ? SEED_OPTIONS.map(
                  name => ctx.interaction?.options.getString(name)?.trim() ?? ''
              ).filter(Boolean)
            : seedsFromArguments(args);
        const label = seeds.join(', ');

        if (!client.queue.hasNode) {
            return await replyFail(client, ctx, tr(ctx, 'commands:core.autoplayNoNode'));
        }

        // Bare /autoplay while it is on means "turn it off".
        if (seeds.length === 0 && existing?.autoplay) {
            await existing.setAutoplay(false);
            return await replyOk(client, ctx, tr(ctx, 'commands:core.autoplayDisabled'));
        }

        let player = existing;
        if (!player || player.isStale) {
            player = await client.queue.create(guild, ctx.voiceChannel, ctx.channel);
        }

        if (seeds.length > 0) {
            const picked = await player.seedFrom(seeds);
            if (!picked) {
                return await replyFail(
                    client,
                    ctx,
                    tr(ctx, 'commands:core.autoplayNoSeed', { label })
                );
            }
            await player.setAutoplay(true);
            await client.db.setAutoplaySetting(guild.id, { source: 'curated', seeds: label });
            return await replyOk(
                client,
                ctx,
                tr(ctx, 'commands:core.autoplaySeeded', {
                    label,
                    title: picked.info.title,
                    author: picked.info.author,
                })
            );
        }

        const first = await player.setAutoplay(true);
        const description = first
            ? tr(ctx, 'commands:core.autoplayStarted', {
                  title: first.info.title,
                  author: first.info.author,
              })
            : tr(ctx, 'commands:core.autoplayWaiting');
        return await replyOk(client, ctx, description);
    },
});
