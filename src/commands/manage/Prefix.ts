import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

const MAX_PIECE = 3;

export default class Prefix extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'prefix',
            description: {
                content: "Shows the bot's prefix",
                examples: ['prefix set', 'prefix reset', 'prefix set !'],
                usage: 'prefix set, prefix reset, prefix set !',
            },
            category: 'general',
            aliases: ['prefix'],
            cooldown: 3,
            args: true,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: ['ManageGuild'],
            },
            slashCommand: true,
            options: [
                {
                    name: 'set',
                    description: 'Sets the prefix',
                    type: ApplicationCommandOptionType.Subcommand,
                    options: [
                        {
                            name: 'prefix',
                            description: 'The prefix you want to set',
                            type: ApplicationCommandOptionType.String,
                            required: true,
                        },
                    ],
                },
                {
                    name: 'reset',
                    description: 'Resets the prefix to the default one',
                    type: ApplicationCommandOptionType.Subcommand,
                },
            ],
        });
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
        const guildId = ctx.guild?.id;
        if (!guildId) return;

        const interaction = ctx.interaction;
        const sub = interaction
            ? (interaction.options.getSubcommand(false) ?? '')
            : (args[0] ?? '');
        const value = interaction
            ? (interaction.options.getString('prefix') ?? '')
            : (args[1] ?? '');

        const record = await client.db.get(guildId);
        const current = record?.prefix ?? client.config.prefix;

        if (sub === 'set') {
            if (!value)
                return await this.reply(
                    client,
                    ctx,
                    `The prefix for this server is \`${current}\``
                );
            const pieces = value
                .split(',')
                .map(piece => piece.trim())
                .filter(Boolean);
            if (pieces.length === 0 || pieces.some(piece => piece.length > MAX_PIECE)) {
                return await this.reply(
                    client,
                    ctx,
                    'Each prefix must be 1–3 characters; combine them with commas.',
                    true
                );
            }
            await client.db.setPrefix(guildId, value);
            return await this.reply(client, ctx, `The prefix for this server is now \`${value}\``);
        }

        if (sub === 'reset') {
            if (!record)
                return await this.reply(
                    client,
                    ctx,
                    `The prefix for this server is \`${client.config.prefix}\``
                );
            await client.db.setPrefix(guildId, client.config.prefix);
            return await this.reply(
                client,
                ctx,
                `The prefix for this server is now \`${client.config.prefix}\``
            );
        }

        return await this.reply(
            client,
            ctx,
            'Please use `prefix set <prefix>` or `prefix reset`.',
            true
        );
    }
}
