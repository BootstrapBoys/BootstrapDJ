import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class Restart extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'restart',
            description: {
                content: 'Restarts the bot process (owner only)',
                usage: 'restart',
                examples: ['restart'],
            },
            category: 'dev',
            aliases: ['reboot'],
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
                    .setColor(client.color.main)
                    .setDescription('Restarting the bot process.'),
            ],
        });
        setTimeout(() => process.kill(process.pid, 'SIGTERM'), 1000);
        return undefined;
    }
}
