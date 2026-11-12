import { ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';
import { isOwner } from '../../lib/CommandGate.js';
import { hasTranslation } from '../../lib/i18n.js';
import { tr } from '../../lib/i18nContext.js';

function quoted(values: readonly string[], none: string): string {
    return values.length ? values.map(value => `\`${value}\``).join(', ') : none;
}

/** Localized command description, falling back to the constructor copy. */
function descriptionOf(ctx: Context, command: Command): string {
    const key = `commands:metadata.${command.name}.description`;
    return hasTranslation(key, ctx.locale) ? tr(ctx, key) : command.description.content;
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
                    autocomplete: true,
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
        const rows: Array<[string, string]> = [
            [tr(ctx, 'longtail:tools.helpLabelDescription'), descriptionOf(ctx, command)],
            [tr(ctx, 'longtail:tools.helpLabelUsage'), `${prefix}${command.description.usage}`],
        ];

        const examples = command.description.examples.filter(example => example.length > 0);
        if (examples.length) {
            rows.push([
                tr(ctx, 'longtail:tools.helpLabelExamples'),
                examples.map(example => `${prefix}${example}`).join(', '),
            ]);
        }
        if (command.aliases.length) {
            rows.push([
                tr(ctx, 'longtail:tools.helpLabelAliases'),
                command.aliases.map(alias => `\`${alias}\``).join(', '),
            ]);
        }

        rows.push([
            tr(ctx, 'longtail:tools.helpLabelCooldown'),
            tr(ctx, 'longtail:tools.helpCooldownValue', { seconds: command.cooldown }),
        ]);
        rows.push([
            tr(ctx, 'longtail:tools.helpLabelPermissions'),
            quoted(command.permissions.user, none),
        ]);

        // Requirements are only worth a row when the command actually has them.
        if (command.player.voice) rows.push([tr(ctx, 'longtail:tools.helpLabelVoice'), yes]);
        if (command.player.dj) rows.push([tr(ctx, 'longtail:tools.helpLabelDj'), yes]);
        if (command.player.active) rows.push([tr(ctx, 'longtail:tools.helpLabelPlayer'), yes]);

        if (command.permissions.dev && isOwner(ctx.author?.id ?? '', client.config.owners)) {
            rows.push([tr(ctx, 'longtail:tools.helpLabelDeveloperOnly'), yes]);
        }

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
        const query = args[0]?.toLowerCase();

        if (!query) {
            return await ctx.sendMessage({ embeds: [this.overview(client, ctx, prefix)] });
        }

        const canonical = client.aliases.get(query);
        const command =
            client.commands.get(query) ?? (canonical ? client.commands.get(canonical) : undefined);

        // Developer commands are not described to anyone outside the owner list.
        if (
            !command ||
            (command.permissions.dev && !isOwner(ctx.author?.id ?? '', client.config.owners))
        ) {
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
