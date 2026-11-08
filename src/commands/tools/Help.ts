import { ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

function quoted(values: readonly string[]): string {
    return values.length ? values.map(value => `\`${value}\``).join(', ') : 'None';
}

function yesNo(value: boolean): string {
    return value ? 'Yes' : 'No';
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

    private overview(client: BootstrapClient, prefix: string): EmbedBuilder {
        const embed = client
            .embed()
            .setColor(client.color.main)
            .setTitle('Help Menu')
            .setDescription(
                `Hey there! I'm ${
                    client.user?.username ?? 'BootstrapDJ'
                }, a music bot made with [BootstrapDJ](https://github.com/zebz213/BootstrapDJ) and Discord. You can use \`${prefix}help <command>\` to get more info on a command.`
            )
            .setFooter({ text: `Use ${prefix}help <command> for more info on a command` });

        for (const [category, names] of this.groups(client)) {
            embed.addFields({ name: category, value: names.join(', '), inline: false });
        }
        return embed;
    }

    private details(client: BootstrapClient, command: Command, prefix: string): EmbedBuilder {
        const rows: Array<[string, string]> = [
            ['Description', command.description.content],
            ['Usage', `${prefix}${command.description.usage}`],
            [
                'Examples',
                command.description.examples.map(example => `${prefix}${example}`).join(', '),
            ],
            ['Aliases', command.aliases.map(alias => `\`${alias}\``).join(', ')],
            ['Category', String(command.category)],
            ['Cooldown', `${command.cooldown} seconds`],
            ['Permissions', quoted(command.permissions.user)],
            ['Bot Permissions', quoted(command.permissions.client)],
            ['Developer Only', yesNo(command.permissions.dev)],
            ['Slash Command', yesNo(command.slashCommand)],
            ['Args', yesNo(command.args)],
            ['Player', yesNo(command.player.active)],
            ['DJ', yesNo(command.player.dj)],
            ['DJ Permissions', command.player.djPerm ?? 'None'],
            ['Voice', yesNo(command.player.voice)],
        ];

        return client
            .embed()
            .setColor(client.color.main)
            .setTitle(`Help Menu - ${command.name}`)
            .setDescription(rows.map(([label, value]) => `**${label}:** ${value}`).join('\n'));
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild || !client.user) return;

        const record = await client.db.get(guild.id);
        const prefix = record?.prefix ?? client.config.prefix;
        const query = args[0];

        if (!query) {
            return await ctx.sendMessage({ embeds: [this.overview(client, prefix)] });
        }

        const command = client.commands.get(query.toLowerCase());
        if (!command) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(`Command \`${query}\` not found`),
                ],
            });
        }

        return await ctx.sendMessage({ embeds: [this.details(client, command, prefix)] });
    }
}
