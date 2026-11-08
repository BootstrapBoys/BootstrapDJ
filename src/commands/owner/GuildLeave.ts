import { BootstrapClient, Command, Context } from '../../core/index.js';

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
        if (!guild) return await ctx.sendMessage('Guild not found');

        try {
            await guild.leave();
            return await ctx.sendMessage(`Left guild ${guild.name}`);
        } catch {
            return await ctx.sendMessage(`Failed to leave guild ${guild.name}`);
        }
    }
}
