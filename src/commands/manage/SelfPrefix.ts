import { BootstrapClient, Command, Context } from '../../core/index.js';

const MAX_PREFIX = 3;

export default class SelfPrefix extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'selfprefix',
            description: {
                content: 'Set a personal prefix for this server',
                usage: 'selfprefix <set|reset> [prefix]',
                examples: ['selfprefix set ?', 'selfprefix reset'],
            },
            category: 'config',
            aliases: ['myprefix'],
            cooldown: 3,
            args: true,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: false,
            options: [],
        });
    }

    private reply(client: BootstrapClient, ctx: Context, text: string, error: boolean = false): Promise<unknown> {
        return ctx.sendMessage({
            embeds: [client.embed().setColor(error ? client.color.red : client.color.main).setDescription(text)],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        const author = ctx.author;
        if (!guild || !author) return;

        const action = (args[0] ?? '').toLowerCase();
        switch (action) {
            case 'list': {
                const current = await client.db.getUserPrefix(guild.id, author.id);
                return await this.reply(
                    client,
                    ctx,
                    current ? `Your personal prefix is \`${current}\`.` : 'You have no personal prefix.'
                );
            }
            case 'reset': {
                const removed = await client.db.resetUserPrefix(guild.id, author.id);
                return await this.reply(
                    client,
                    ctx,
                    removed ? 'Personal prefix reset.' : 'You had no personal prefix.'
                );
            }
            default:
                break;
        }

        if (action !== 'set') {
            return await this.reply(client, ctx, 'Use `selfprefix set <prefix>` or `selfprefix reset`.', true);
        }
        const prefix = (args[1] ?? '').trim();
        if (!prefix || prefix.length > MAX_PREFIX) {
            return await this.reply(client, ctx, 'Prefixes must be 1–3 characters.', true);
        }
        await client.db.setUserPrefix(guild.id, author.id, prefix);
        return await this.reply(client, ctx, `Your personal prefix is now \`${prefix}\`.`);
    }
}
