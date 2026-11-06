import { ChannelType, Collection, Message, PermissionFlagsBits } from 'discord.js';

import { BootstrapClient, Context, Event } from '../../structures/index.js';

export default class MessageCreate extends Event {
    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'messageCreate',
        });
    }
    public async run(message: Message): Promise<unknown> {
        if (message.author.bot) return;
        // Narrows to Message<true>: guild, member and guildId are then non-null.
        if (!message.inGuild()) return;
        const me = message.guild.members.me;
        const member = message.member;
        const botId = this.client.user?.id;
        if (!me || !member || !botId) return;

        // Handler replies (permissions, cooldown, missing args) are sent straight
        // to the channel, so Context never arms them. Give them the same lifetime
        // as command output instead of leaving them behind.
        const replySafe = async (content: any): Promise<Message> => {
            const sent = await message.reply(content);
            this.client.utils.scheduleDelete(this.client, sent);
            return sent;
        };

        const setup = await this.client.db.getSetup(message.guildId);
        if (setup && setup.textId) {
            if (setup.textId === message.channelId) {
                return this.client.emit('setupSystem', message);
            }
        }
        const guild = await this.client.db.get(message.guildId);
        if (!guild) return;
        const guildSettings = await this.client.db.getGuildSettings(message.guildId);

        const mention = new RegExp(`^<@!?${botId}>( |)$`);
        if (message.content.match(mention)) {
            await replySafe({
                content: `Hey, my prefix for this server is \`${guild.prefix}\` Want more info? then do \`${guild.prefix}help\`\nStay Safe, Stay Awesome!`,
            });
            return;
        }
        const escapeRegex = (str: string): string => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const userPrefix = await this.client.db.getUserPrefix(message.guildId, message.author.id);
        const serverPrefixes = guild.prefix
            .split(',')
            .map(prefix => prefix.trim())
            .filter(Boolean);
        const prefixes = userPrefix ? [...new Set([...serverPrefixes, userPrefix])] : serverPrefixes;
        const prefixRegex = new RegExp(
            `^(<@!?${botId}>|${prefixes.map(prefix => escapeRegex(prefix)).join('|')})\\s*`
        );
        const match = message.content.match(prefixRegex);
        if (!match) return;
        const [matchedPrefix] = match;

        const args = message.content.slice(matchedPrefix.length).trim().split(/ +/g);

        let cmd = args.shift()?.toLowerCase();
        if (!cmd) return;
        const mapping = await this.client.db.getCommandMapping(message.guildId, cmd, message.author.id);
        if (mapping) {
            const expanded = mapping.expansion.trim().split(/ +/g);
            const mappedCommand = expanded.shift()?.toLowerCase();
            if (mappedCommand) {
                cmd = mappedCommand;
                args.unshift(...expanded);
            }
        }
        let command =
            this.client.commands.get(cmd) ||
            this.client.commands.get(this.client.aliases.get(cmd) as string);
        if (!command) {
            const custom = await this.client.db.getCommandAlias(message.guildId, cmd, message.author.id);
            if (custom) command = this.client.commands.get(custom.command);
        }
        if (!command) {
            if (guildSettings.autocorrect === 'true') {
                const suggestion = this.closestCommand(cmd);
                if (suggestion) {
                    command = this.client.commands.get(suggestion);
                    if (command) {
                        const prefix = guild.prefix.split(',')[0]?.trim() || this.client.config.prefix;
                        await replySafe({ content: `Corrected \`${prefix}${cmd}\` to \`${prefix}${suggestion}\`.` });
                        cmd = suggestion;
                    }
                }
            }
            if (!command) return;
        }
        if (command.player?.voice) {
            const preferred = await this.client.preferredBotStatus(message.guildId);
            if (!preferred.allowed) {
                return await replySafe({
                    content: `Voice commands are routed to **${preferred.name ?? 'the preferred bot'}** for this server. Use that bot.`,
                });
            }
        }
        if (
            guildSettings.locked === 'true' &&
            'permissions' in member &&
            !member.permissions.has(PermissionFlagsBits.ManageGuild)
        ) {
            return await replySafe({ content: 'This session is locked. A server manager must unlock it.' });
        }
        const permitted = await this.client.db.isCommandAllowed(
            message.guildId,
            command.name,
            message.author.id,
            [...member.roles.cache.keys()]
        );
        if (!permitted) {
            return await replySafe({ content: 'You are not allowed to use this command.' });
        }
        if (guildSettings.allowthreads === 'false' && message.channel.isThread()) {
            return await replySafe({ content: 'Commands are disabled in threads for this server.' });
        }
        if (
            (guildSettings.disabledcommands ?? '')
                .split(',')
                .map(name => name.trim().toLowerCase())
                .filter(Boolean)
                .includes(command.name)
        ) {
            return await replySafe({ content: `**${command.name}** is disabled in this server.` });
        }
        if (guildSettings.commandchannel && guildSettings.commandchannel !== message.channelId) {
            return await replySafe({ content: `Commands are restricted to <#${guildSettings.commandchannel}>.` });
        }
        if (guildSettings.voicechannel && member.voice.channelId !== guildSettings.voicechannel) {
            return await replySafe({ content: `You must be in <#${guildSettings.voicechannel}> to use commands.` });
        }
        const ctx = new Context(message, args);
        ctx.deleteAfter = Number(guildSettings.deleteafter) || null;
        ctx.setArgs(args);

        if (message.channel.permissionsFor(me)?.has(PermissionFlagsBits.ViewChannel) !== true) return;

        if (!me.permissions.has(PermissionFlagsBits.SendMessages))
            return await message.author
                .send({
                    content: `I don't have **\`SendMessage\`** permission in \`${message.guild.name}\`\nchannel: <#${message.channelId}>`,
                })
                .catch(() => { });

        if (!me.permissions.has(PermissionFlagsBits.EmbedLinks))
            return await replySafe({
                content: 'I don\'t have **`EmbedLinks`** permission.',
            });

        if (command.permissions) {
            if (command.permissions.client) {
                if (!me.permissions.has(command.permissions.client))
                    return await replySafe({
                        content: 'I don\'t have enough permissions to execute this command.',
                    });
            }

            if (command.permissions.user) {
                if (!member.permissions.has(command.permissions.user))
                    return await replySafe({
                        content: 'You don\'t have enough permissions to use this command.',
                    });
            }
            if (command.permissions.dev) {
                if (this.client.config.owners) {
                    const findDev = this.client.config.owners.find(x => x === message.author.id);
                    if (!findDev) return;
                }
            }
        }
        if (command.player) {
            if (command.player.voice) {
                if (!member.voice.channel)
                    return await replySafe({
                        content: `You must be connected to a voice channel to use this \`${command.name}\` command.`,
                    });

                if (!me.permissions.has(PermissionFlagsBits.Connect))
                    return await replySafe({
                        content: `I don't have \`CONNECT\` permissions to execute this \`${command.name}\` command.`,
                    });

                if (!me.permissions.has(PermissionFlagsBits.Speak))
                    return await replySafe({
                        content: `I don't have \`SPEAK\` permissions to execute this \`${command.name}\` command.`,
                    });

                if (
                    member.voice.channel.type === ChannelType.GuildStageVoice &&
                    !me.permissions.has(PermissionFlagsBits.RequestToSpeak)
                )
                    return await replySafe({
                        content: `I don't have \`REQUEST TO SPEAK\` permission to execute this \`${command.name}\` command.`,
                    });

                if (me.voice.channel) {
                    if (me.voice.channelId !== member.voice.channelId)
                        return await replySafe({
                            content: `You are not connected to <#${me.voice.channel.id}> to use this \`${command.name}\` command.`,
                        });
                }
            }
            if (command.player.active) {
                const player = this.client.queue.get(message.guildId);
                if (!player || !player.current)
                    return await replySafe({
                        content: 'Nothing is playing right now.',
                    });
            }
            if (command.player.dj) {
                const dj = await this.client.db.getDj(message.guildId);
                if (dj && dj.mode) {
                    const djRole = await this.client.db.getRoles(message.guildId);
                    if (!djRole)
                        return await replySafe({
                            content: 'DJ role is not set.',
                        });
                    const findDJRole = member.roles.cache.find((x: any) =>
                        djRole.map((y: any) => y.roleId).includes(x.id)
                    );
                    if (!findDJRole) {
                        if (!member.permissions.has(PermissionFlagsBits.ManageGuild)) {
                            return await replySafe({
                                content: 'You need to have the DJ role to use this command.',
                            });
                        }
                    }
                }
            }
        }
        if (command.args) {
            if (!args.length) {
                const embed = this.client
                    .embed()
                    .setColor(this.client.color.red)
                    .setTitle('Missing Arguments')
                    .setDescription(
                        `Please provide the required arguments for the \`${command.name
                        }\` command.\n\nExamples:\n${command.description.examples
                            ? command.description.examples.join('\n')
                            : 'None'
                        }`
                    )
                    .setFooter({ text: 'Syntax: [] = optional, <> = required' });
                return await replySafe({ embeds: [embed] });
            }
        }

        let timestamps = this.client.cooldown.get(cmd);
        if (!timestamps) {
            timestamps = new Collection<string, number>();
            this.client.cooldown.set(cmd, timestamps);
        }
        const now = Date.now();

        const cooldownAmount = Math.floor(command.cooldown || 5) * 1000;
        if (!timestamps.has(message.author.id)) {
            timestamps.set(message.author.id, now);
            setTimeout(() => timestamps.delete(message.author.id), cooldownAmount);
        } else {
            const expirationTime = (timestamps.get(message.author.id) ?? now) + cooldownAmount;
            const timeLeft = (expirationTime - now) / 1000;
            if (now < expirationTime && timeLeft > 0.9) {
                return await replySafe({
                    content: `Please wait ${timeLeft.toFixed(
                        1
                    )} more second(s) before reusing the \`${cmd}\` command.`,
                });
            }
            timestamps.set(message.author.id, now);
            setTimeout(() => timestamps.delete(message.author.id), cooldownAmount);
        }
        if (args.includes('@everyone') || args.includes('@here'))
            return await replySafe({
                content: 'You can\'t use this command with everyone or here.',
            });

        try {
            // `return command.run(...)` without await lets async rejections skip
            // this catch and surface as unhandled rejections instead.
            return await command.run(this.client, ctx, ctx.args);
        } catch (error) {
            this.client.logger.error(error);
            await replySafe({ content: `An error occurred: \`${error}\`` });
            return;
        }
    }
    private closestCommand(input: string): string | null {
        const distance = (a: string, b: string): number => {
            const rows = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
            for (let j = 1; j <= b.length; j++) rows[0][j] = j;
            for (let i = 1; i <= a.length; i++) {
                for (let j = 1; j <= b.length; j++) {
                    rows[i][j] = Math.min(
                        rows[i - 1][j] + 1,
                        rows[i][j - 1] + 1,
                        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
                    );
                }
            }
            return rows[a.length][b.length];
        };
        let best: string | null = null;
        let score = 3;
        for (const name of this.client.commands.keys()) {
            const value = distance(input, name);
            if (value < score) {
                score = value;
                best = name;
            }
        }
        return best;
    }

}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
