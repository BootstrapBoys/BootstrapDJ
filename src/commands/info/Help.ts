import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class Help extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'help',
            description: {
                content: 'Shows the help menu',
                examples: ['help'],
                usage: 'help',
            },
            category: 'info',
            aliases: ['h'],
            cooldown: 3,
            args: false,
            player: {
                voice: false,
                dj: false,
                active: false,
                djPerm: null,
            },
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
                    type: 3,
                    required: false,
                },
            ],
        });
    }
    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const embed = client.embed();
        const guildId = ctx.guild?.id;
        const clientUser = client.user;
        if (!guildId || !clientUser) return;
        const guild = await client.db.get(guildId);
        const prefix = guild ? guild.prefix : client.config.prefix;
        const commands = this.client.commands.filter(cmd => cmd.category !== 'dev');
        const categories = [
            ...new Set(commands.map(cmd => cmd.category).filter((value): value is string => value !== null)),
        ];

        if (!args[0]) {
            const fildes: { name: string; value: string; inline: boolean }[] = [];
            categories.forEach(category => {
                fildes.push({
                    name: category,
                    value: commands
                        .filter(cmd => cmd.category === category)
                        .map(cmd => `\`${cmd.name}\``)
                        .join(', '),
                    inline: false,
                });
            });
            const helpEmbed = embed
                .setColor(this.client.color.main)
                .setTitle('Help Menu')
                .setDescription(
                    `Hey there! I'm ${clientUser.username}, a music bot made with [BootstrapDJ](https://github.com/zebz213/BootstrapDJ) and Discord. You can use \`${prefix}help <command>\` to get more info on a command.`
                )
                .setFooter({
                    text: `Use ${prefix}help <command> for more info on a command`,
                });
            fildes.forEach(field => helpEmbed.addFields(field));
            ctx.sendMessage({ embeds: [helpEmbed] });
        } else {
            const command = this.client.commands.get(args[0].toLowerCase());
            if (!command)
                return await ctx.sendMessage({
                    embeds: [
                        client
                            .embed()
                            .setColor(client.color.red)
                            .setDescription(`Command \`${args[0]}\` not found`),
                    ],
                });
            const embed = this.client.embed();
            const helpEmbed = embed
                .setColor(this.client.color.main)
                .setTitle(`Help Menu - ${command.name}`).setDescription(`**Description:** ${command.description.content
                    }
**Usage:** ${prefix}${command.description.usage}
**Examples:** ${command.description.examples.map(example => `${prefix}${example}`).join(', ')}
**Aliases:** ${command.aliases.map(alias => `\`${alias}\``).join(', ')}
**Category:** ${command.category}
**Cooldown:** ${command.cooldown} seconds
**Permissions:** ${command.permissions.user.length > 0
                        ? command.permissions.user.map(perm => `\`${perm}\``).join(', ')
                        : 'None'
                    }
**Bot Permissions:** ${command.permissions.client.map(perm => `\`${perm}\``).join(', ')}
**Developer Only:** ${command.permissions.dev ? 'Yes' : 'No'}
**Slash Command:** ${command.slashCommand ? 'Yes' : 'No'}
**Args:** ${command.args ? 'Yes' : 'No'}
**Player:** ${command.player.active ? 'Yes' : 'No'}
**DJ:** ${command.player.dj ? 'Yes' : 'No'}
**DJ Permissions:** ${command.player.djPerm ? command.player.djPerm : 'None'}
**Voice:** ${command.player.voice ? 'Yes' : 'No'}`);
            ctx.sendMessage({ embeds: [helpEmbed] });
        }
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
