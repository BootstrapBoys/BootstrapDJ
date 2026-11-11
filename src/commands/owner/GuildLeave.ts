import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

export default class GuildLeave extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'guildleave',
            description: {
                content: 'Leave a guild',
                examples: ['guildleave'],
                usage: 'guildleave',
            },
            category: 'dev',
            aliases: ['gl'],
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

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guildId = args[0];
        const guild = guildId ? client.guilds.cache.get(guildId) : undefined;
        if (!guild) return await ctx.sendMessage(tr(ctx, 'longtail:owner.guildLeaveNotFound'));

        try {
            await guild.leave();
            return await ctx.sendMessage(
                tr(ctx, 'longtail:owner.guildLeft', { guild: guild.name })
            );
        } catch {
            return await ctx.sendMessage(
                tr(ctx, 'longtail:owner.guildLeaveFailed', { guild: guild.name })
            );
        }
    }
}
