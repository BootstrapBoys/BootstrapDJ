import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class Reload extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'reload',
            description: { content: 'Reloads command modules without restarting (owner only)', usage: 'reload', examples: ['reload'] },
            category: 'dev',
            aliases: ['reloadcommands'],
            cooldown: 10,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: { dev: true, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
            slashCommand: false,
            options: [],
        });
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const count = await client.reloadCommands();
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.green)
                    .setDescription(`Reloaded **${count}** commands. Slash metadata changes still need a restart.`),
            ],
        });
    }
}
