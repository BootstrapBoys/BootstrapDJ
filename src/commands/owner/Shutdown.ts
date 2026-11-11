import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

export default class Shutdown extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'shutdown',
            description: {
                content: 'Stops the bot process (owner only)',
                usage: 'shutdown',
                examples: ['shutdown'],
            },
            category: 'dev',
            aliases: ['stopbot'],
            cooldown: 10,
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
        await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.red)
                    .setDescription(tr(ctx, 'longtail:owner.shuttingDown')),
            ],
        });
        setTimeout(() => process.kill(process.pid, 'SIGTERM'), 1000);
        return undefined;
    }
}
