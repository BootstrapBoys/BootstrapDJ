import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../structures/index.js';
import { AUTOPLAY_FIELDS, DEFAULTS, isKnownSetting } from '../../utils/SettingsSchema.js';

function isKnown(key: string): key is keyof typeof DEFAULTS {
    return isKnownSetting(key);
}
const SETTING_CHOICES = [...new Set([...Object.keys(DEFAULTS), 'autoplayreset'])]
    .filter(key => key !== 'volumeautomatic' && key !== 'maxplaylistlength')
    .slice(0, 25)
    .map(key => ({ name: key, value: key }));


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
                    choices: SETTING_CHOICES,
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
            const autoplay = await client.db.getAutoplaySetting(guild.id).catch(() => null);
            const lines = Object.entries(DEFAULTS).map(([name, fallback]) => {
                if (name === 'autoplaysource' || name === 'autoplayseeds') return null;
                const current = values[name] ?? fallback;
                return `**${name}**: \`${current}\`${values[name] ? '' : ' *(default)*'}`;
            }).filter((line): line is string => Boolean(line));
            lines.push(
                `**autoplaysource**: \`${autoplay?.source ?? 'environment default'}\``,
                `**autoplayseeds**: \`${autoplay?.seeds || client.config.autoplaySeeds.join(', ') || 'none'}\``
            );
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

        if (AUTOPLAY_FIELDS.has(key)) {
            const current = await client.db.getAutoplaySetting(guild.id).catch(() => null);
            if (!value) {
                const source = current?.source ?? 'environment default';
                const seeds = current?.seeds || client.config.autoplaySeeds.join(', ') || 'none';
                return await ctx.sendMessage({
                    embeds: [
                        client
                            .embed()
                            .setColor(client.color.main)
                            .setTitle('Autoplay settings')
                            .setDescription(
                                `**source**: \`${source}\`\n**seeds**: \`${seeds}\`\n**legacy value**: \`${client.config.autoplaySeed || 'none'}\``
                            ),
                    ],
                });
            }
            if (key === 'autoplayreset') {
                await client.db.deleteAutoplaySetting(guild.id);
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.green).setDescription('Autoplay override removed.')],
                });
            }
            if (key === 'autoplaysource') {
                if (!['chart', 'curated', 'legacy'].includes(value)) {
                    return await ctx.sendMessage({
                        embeds: [client.embed().setColor(client.color.red).setDescription('Source must be `chart`, `curated`, or `legacy`.')],
                    });
                }
                await client.db.setAutoplaySetting(guild.id, {
                    source: value,
                    seeds: current?.seeds ?? client.config.autoplaySeeds.join(', '),
                });
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.green).setDescription(`Autoplay source set to **${value}**.`)],
                });
            }
            const seeds = value
                .split(',')
                .map(seed => seed.trim())
                .filter(Boolean)
                .slice(0, 10);
            if (!seeds.length) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('Provide at least one seed.')],
                });
            }
            await client.db.setAutoplaySetting(guild.id, { source: 'curated', seeds: seeds.join(', ') });
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.green).setDescription(`Autoplay seeds set to **${seeds.join(', ')}**.`)],
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
        if (key === 'ephemeral' && value !== 'true' && value !== 'false') {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription('`ephemeral` must be `true` (private) or `false` (public).'),
                ],
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
