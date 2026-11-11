import { ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { tr } from '../../lib/i18nContext.js';

function quoted(values: readonly string[], none: string): string {
    return values.length ? values.map(value => `\`${value}\``).join(', ') : none;
}

function yesNo(value: boolean, yes: string, no: string): string {
    return value ? yes : no;
}

export default class Help extends Command {
    public constructor(client: BootstrapClient) {
        super(client, {
            name: 'help',
            description: { content: 'Shows the help menu', examples: ['help'], usage: 'help' },
            category: 'info',
            aliases: ['h'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [
                {
                    name: 'command',
                    description: 'The command you want to get info on',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
            ],
        });
    }

    /** Command names grouped by category, in first-seen order. */
    private groups(client: BootstrapClient): Map<string, string[]> {
        const grouped = new Map<string, string[]>();
        for (const command of client.commands.values()) {
            if (!command.category || command.category === 'dev') continue;
            const names = grouped.get(command.category) ?? [];
            names.push(`\`${command.name}\``);
            grouped.set(command.category, names);
        }
        return grouped;
    }

    private overview(client: BootstrapClient, ctx: Context, prefix: string): EmbedBuilder {
        const embed = client
            .embed()
            .setColor(client.color.main)
            .setTitle(tr(ctx, 'longtail:tools.helpTitle'))
            .setDescription(
                tr(ctx, 'longtail:tools.helpIntro', {
                    bot: client.user?.username ?? 'BootstrapDJ',
                    prefix,
                })
            )
            .setFooter({ text: tr(ctx, 'longtail:tools.helpFooter', { prefix }) });

        for (const [category, names] of this.groups(client)) {
            embed.addFields({ name: category, value: names.join(', '), inline: false });
        }
        return embed;
    }

    private details(
        client: BootstrapClient,
        ctx: Context,
        command: Command,
        prefix: string
    ): EmbedBuilder {
        const none = tr(ctx, 'longtail:tools.helpNone');
        const yes = tr(ctx, 'longtail:tools.helpYes');
        const no = tr(ctx, 'longtail:tools.helpNo');
        const flag = (value: boolean): string => yesNo(value, yes, no);
        const rows: Array<[string, string]> = [
            [tr(ctx, 'longtail:tools.helpLabelDescription'), command.description.content],
            [tr(ctx, 'longtail:tools.helpLabelUsage'), `${prefix}${command.description.usage}`],
            [
                tr(ctx, 'longtail:tools.helpLabelExamples'),
                command.description.examples.map(example => `${prefix}${example}`).join(', '),
            ],
            [
                tr(ctx, 'longtail:tools.helpLabelAliases'),
                command.aliases.map(alias => `\`${alias}\``).join(', '),
            ],
            [tr(ctx, 'longtail:tools.helpLabelCategory'), String(command.category)],
            [
                tr(ctx, 'longtail:tools.helpLabelCooldown'),
                tr(ctx, 'longtail:tools.helpCooldownValue', { seconds: command.cooldown }),
            ],
            [
                tr(ctx, 'longtail:tools.helpLabelPermissions'),
                quoted(command.permissions.user, none),
            ],
            [
                tr(ctx, 'longtail:tools.helpLabelBotPermissions'),
                quoted(command.permissions.client, none),
            ],
            [tr(ctx, 'longtail:tools.helpLabelDeveloperOnly'), flag(command.permissions.dev)],
            [tr(ctx, 'longtail:tools.helpLabelSlashCommand'), flag(command.slashCommand)],
            [tr(ctx, 'longtail:tools.helpLabelArgs'), flag(command.args)],
            [tr(ctx, 'longtail:tools.helpLabelPlayer'), flag(command.player.active)],
            [tr(ctx, 'longtail:tools.helpLabelDj'), flag(command.player.dj)],
            [tr(ctx, 'longtail:tools.helpLabelDjPermissions'), command.player.djPerm ?? none],
            [tr(ctx, 'longtail:tools.helpLabelVoice'), flag(command.player.voice)],
        ];

        return client
            .embed()
            .setColor(client.color.main)
            .setTitle(tr(ctx, 'longtail:tools.helpDetailsTitle', { command: command.name }))
            .setDescription(
                rows
                    .map(([label, value]) => tr(ctx, 'longtail:tools.helpField', { label, value }))
                    .join('\n')
            );
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild || !client.user) return;

        const record = await client.db.get(guild.id);
        const prefix = record?.prefix ?? client.config.prefix;
        const query = args[0];

        if (!query) {
            return await ctx.sendMessage({ embeds: [this.overview(client, ctx, prefix)] });
        }

        const command = client.commands.get(query.toLowerCase());
        if (!command) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(tr(ctx, 'longtail:tools.helpNotFound', { query })),
                ],
            });
        }

        return await ctx.sendMessage({ embeds: [this.details(client, ctx, command, prefix)] });
    }
}
