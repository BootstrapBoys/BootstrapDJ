import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

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

    private copy(
        ctx: Context,
        key: string,
        variables: Record<string, string | number> = {}
    ): string {
        return tr(ctx, `longtail:manage.selfPrefix.${key}`, variables);
    }

    private reply(
        client: BootstrapClient,
        ctx: Context,
        text: string,
        error: boolean = false
    ): Promise<unknown> {
        return ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(error ? client.color.red : client.color.main)
                    .setDescription(text),
            ],
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
                    current
                        ? this.copy(ctx, 'current', { prefix: current })
                        : this.copy(ctx, 'none')
                );
            }
            case 'reset': {
                const removed = await client.db.resetUserPrefix(guild.id, author.id);
                return await this.reply(
                    client,
                    ctx,
                    this.copy(ctx, removed ? 'reset' : 'nothingToReset')
                );
            }
            default:
                break;
        }

        if (action !== 'set') {
            return await this.reply(client, ctx, this.copy(ctx, 'usage'), true);
        }
        const prefix = (args[1] ?? '').trim();
        if (!prefix || prefix.length > MAX_PREFIX) {
            return await this.reply(client, ctx, this.copy(ctx, 'invalid'), true);
        }
        await client.db.setUserPrefix(guild.id, author.id, prefix);
        return await this.reply(client, ctx, this.copy(ctx, 'set', { prefix }));
    }
}
