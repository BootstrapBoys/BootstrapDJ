import { Message, PermissionFlagsBits } from 'discord.js';

import { BootstrapClient, Context, Event } from '../../structures/index.js';
import { evaluateCommand } from '../../utils/CommandGate.js';

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
        const guildSettings = await this.client.db.getGuildSettings(message.guildId);
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
        const gate = await evaluateCommand({
            client: this.client,
            command,
            guildId: message.guildId,
            guildName: message.guild.name,
            member: {
                id: message.author.id,
                roleIds: [...member.roles.cache.keys()],
                hasPermission: permission => member.permissions.has(permission),
                voiceChannel: member.voice.channel
                    ? { id: member.voice.channel.id, type: member.voice.channel.type }
                    : null,
            },
            me: {
                id: me.id,
                roleIds: [...me.roles.cache.keys()],
                hasPermission: permission => me.permissions.has(permission),
                voiceChannel: me.voice.channel
                    ? { id: me.voice.channel.id, type: me.voice.channel.type }
                    : null,
            },
            channel: message.channel,
            canViewChannel:
                message.channel.permissionsFor(me)?.has(PermissionFlagsBits.ViewChannel) === true,
            settings: guildSettings,
            args,
            commandKey: cmd,
            isPrefix: true,
        });
        if (!gate.ok) {
            if (gate.silent || !gate.response) return;
            if (gate.dm) {
                await message.author.send(gate.response).catch(() => {});
                return;
            }
            return await replySafe(gate.response);
        }

        const ctx = new Context(message, args);
        ctx.deleteAfter = Number(guildSettings.deleteafter) || null;
        ctx.setArgs(args);

        void this.client.db.recordCommand(message.guildId, command.name).catch(() => {});
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
