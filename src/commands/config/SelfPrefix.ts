import { BootstrapClient, Command, Context } from '../../structures/index.js';

export default class SelfPrefix extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'selfprefix',
            description: { content: 'Set a personal prefix for this server', usage: 'selfprefix <set|reset> [prefix]', examples: ['selfprefix set ?', 'selfprefix reset'] },
            category: 'config',
            aliases: ['myprefix'],
            cooldown: 3,
            args: true,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
            slashCommand: false,
            options: [],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        const author = ctx.author;
        if (!guild || !author) return;
        const action = (args[0] ?? '').toLowerCase();
        if (action === 'reset') {
            const removed = await client.db.resetUserPrefix(guild.id, author.id);
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.green)
                        .setDescription(removed ? 'Personal prefix reset.' : 'You had no personal prefix.'),
                ],
            });
        }
        if (action !== 'set') {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Use `selfprefix set <prefix>` or `selfprefix reset`.')],
            });
        }
        const prefix = args[1]?.trim();
        if (!prefix || prefix.length > 3) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Prefixes must be 1–3 characters.')],
            });
        }
        await client.db.setUserPrefix(guild.id, author.id, prefix);
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.green)
                    .setDescription(`Your personal prefix is now \`${prefix}\`.`),
            ],
        });
    }
}
