import { ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

function permissionList(values: string[]): string {
    return values.length ? values.map(value => `\`${value}\``).join(', ') : 'None';
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
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
            slashCommand: true,
            options: [
                { name: 'command', description: 'The command you want to get info on', type: ApplicationCommandOptionType.String, required: false },
            ],
        });
    }

    private overview(client: BootstrapClient, prefix: string): EmbedBuilder {
        const visible = client.commands.filter(command => command.category !== 'dev');
        const categories = [...new Set(visible.map(command => command.category).filter((value): value is string => Boolean(value)))];
        const embed = client
            .embed()
            .setColor(client.color.main)
            .setTitle('Help Menu')
            .setDescription(
                `Hey there! I'm ${client.user?.username ?? 'BootstrapDJ'}, a music bot made with [BootstrapDJ](https://github.com/zebz213/BootstrapDJ) and Discord. You can use \`${prefix}help <command>\` to get more info on a command.`
            )
            .setFooter({ text: `Use ${prefix}help <command> for more info on a command` });
        for (const category of categories) {
            embed.addFields({
                name: category,
                value: visible
                    .filter(command => command.category === category)
                    .map(command => `\`${command.name}\``)
                    .join(', '),
                inline: false,
            });
        }
        return embed;
    }

    private details(client: BootstrapClient, command: Command, prefix: string): EmbedBuilder {
        const examples = command.description.examples.map(example => `${prefix}${example}`).join(', ');
        return client
            .embed()
            .setColor(client.color.main)
            .setTitle(`Help Menu - ${command.name}`)
            .setDescription(
                `**Description:** ${command.description.content}
**Usage:** ${prefix}${command.description.usage}
**Examples:** ${examples}
**Aliases:** ${command.aliases.map(alias => `\`${alias}\``).join(', ')}
**Category:** ${command.category}
**Cooldown:** ${command.cooldown} seconds
**Permissions:** ${permissionList(command.permissions.user)}
**Bot Permissions:** ${permissionList(command.permissions.client)}
**Developer Only:** ${command.permissions.dev ? 'Yes' : 'No'}
**Slash Command:** ${command.slashCommand ? 'Yes' : 'No'}
**Args:** ${command.args ? 'Yes' : 'No'}
**Player:** ${command.player.active ? 'Yes' : 'No'}
**DJ:** ${command.player.dj ? 'Yes' : 'No'}
**DJ Permissions:** ${command.player.djPerm ?? 'None'}
**Voice:** ${command.player.voice ? 'Yes' : 'No'}`
            );
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        if (!ctx.guild || !client.user) return;
        const record = await client.db.get(ctx.guild.id);
        const prefix = record?.prefix ?? client.config.prefix;
        if (!args[0]) {
            return await ctx.sendMessage({ embeds: [this.overview(client, prefix)] });
        }
        const command = client.commands.get(args[0].toLowerCase());
        if (!command) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription(`Command \`${args[0]}\` not found`)],
            });
        }
        return await ctx.sendMessage({ embeds: [this.details(client, command, prefix)] });
    }
}
