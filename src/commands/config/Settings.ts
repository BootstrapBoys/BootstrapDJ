import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../structures/index.js';

const DEFAULTS: Record<string, string> = {
    defaultvolume: '100',
    defaultautoplay: 'false',
    defaultrepeat: 'off',
    defaultshuffle: 'false',
    searchtype: 'dzsearch',
    maxqueue: '200',
    maxuserqueue: '50',
    voteskip: 'true',
    voteskippercent: '50',
    announce: 'true',
    deleteafter: '10',
    commandchannel: '',
    voicechannel: '',
};

function isKnown(key: string): key is keyof typeof DEFAULTS {
    return Object.prototype.hasOwnProperty.call(DEFAULTS, key);
}

export default class Settings extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'settings',
            description: { content: 'View or change per-guild bot settings', usage: 'settings [key] [value]', examples: ['settings', 'settings defaultvolume 80'] },
            category: 'config',
            aliases: ['config', 'guildsettings'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: ['ManageGuild'],
            },
            slashCommand: true,
            options: [
                {
                    name: 'key',
                    description: 'Setting name; omit to list all',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                    choices: Object.keys(DEFAULTS).map(key => ({ name: key, value: key })),
                },
                {
                    name: 'value',
                    description: 'New value; omit to inspect the setting',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                },
                {
                    name: 'reset',
                    description: 'Reset every setting for this guild',
                    type: ApplicationCommandOptionType.Boolean,
                    required: false,
                },
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const reset = ctx.isInteraction
            ? Boolean(ctx.interaction?.options.getBoolean('reset'))
            : args[0] === 'reset';
        if (reset) {
            const removed = await client.db.resetGuildSettings(guild.id);
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.green)
                        .setDescription(`Reset ${removed} guild setting${removed === 1 ? '' : 's'}.`),
                ],
            });
        }
        const key = (
            ctx.isInteraction ? String(ctx.interaction?.options.getString('key') ?? '') : args[0] ?? ''
        )
            .trim()
            .toLowerCase();
        const value = (
            ctx.isInteraction
                ? String(ctx.interaction?.options.getString('value') ?? '')
                : args.slice(1).join(' ')
        ).trim();

        if (!key) {
            const values = await client.db.getGuildSettings(guild.id);
            const lines = Object.entries(DEFAULTS).map(([name, fallback]) => {
                const current = values[name] ?? fallback;
                return `**${name}**: \`${current}\`${values[name] ? '' : ' *(default)*'}`;
            });
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setTitle('Guild settings')
                        .setDescription(lines.join('\n')),
                ],
            });
        }

        if (!isKnown(key)) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription(`Unknown setting. Use one of: ${Object.keys(DEFAULTS).join(', ')}.`),
                ],
            });
        }

        if (!value) {
            const current = (await client.db.getGuildSetting(guild.id, key)) ?? DEFAULTS[key];
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setDescription(`**${key}**: \`${current}\``),
                ],
            });
        }

        if (value.length > 200) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('That value is too long.')],
            });
        }
        await client.db.setGuildSetting(guild.id, key, value);
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.green)
                    .setDescription(`Set **${key}** to \`${value}\`.`),
            ],
        });
    }
}
