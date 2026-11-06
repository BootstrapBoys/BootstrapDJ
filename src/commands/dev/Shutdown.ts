import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class Shutdown extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'shutdown',
            description: { content: 'Stops the bot process (owner only)', usage: 'shutdown', examples: ['shutdown'] },
            category: 'dev',
            aliases: ['stopbot'],
            cooldown: 10,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: { dev: true, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
            slashCommand: false,
            options: [],
        });
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        await ctx.sendMessage({
            embeds: [client.embed().setColor(client.color.red).setDescription('Shutting down the bot process.')],
        });
        setTimeout(() => process.kill(process.pid, 'SIGTERM'), 1000);
        return undefined;
    }
}
