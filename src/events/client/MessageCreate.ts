import { GuildMember, Message, MessageReplyOptions, PermissionFlagsBits } from 'discord.js';

import { BootstrapClient, Context, Event } from '../../core/index.js';
import { evaluateCommand, type GateMember } from '../../lib/CommandGate.js';
import { matchPrefixCommand } from '../../lib/PrefixCommand.js';

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function gateMember(member: GuildMember): GateMember {
    return {
        id: member.id,
        roleIds: [...member.roles.cache.keys()],
        hasPermission: (permission: bigint) => member.permissions.has(permission),
        voiceChannel: member.voice.channel
            ? { id: member.voice.channel.id, type: member.voice.channel.type }
            : null,
    };
}

/** Levenshtein distance, bounded by the caller's tolerance. */
function editDistance(left: string, right: string): number {
    const rows = left.length + 1;
    const columns = right.length + 1;
    const table: number[][] = Array.from({ length: rows }, () =>
        Array.from({ length: columns }, () => 0)
    );
    for (let row = 0; row < rows; row++) table[row][0] = row;
    for (let column = 0; column < columns; column++) table[0][column] = column;
    for (let row = 1; row < rows; row++) {
        for (let column = 1; column < columns; column++) {
            const substitution = left[row - 1] === right[column - 1] ? 0 : 1;
            table[row][column] = Math.min(
                table[row - 1][column] + 1,
                table[row][column - 1] + 1,
                table[row - 1][column - 1] + substitution
            );
        }
    }
    return table[left.length][right.length];
}

export default class MessageCreate extends Event {
    public constructor(client: BootstrapClient, file: string) {
        super(client, file, { name: 'messageCreate' });
    }

    /** Server prefixes are comma-separated; a personal prefix wins ties. */
    private prefixList(guildPrefix: string, userPrefix: string | null): string[] {
        const server = guildPrefix
            .split(',')
            .map(prefix => prefix.trim())
            .filter(Boolean);
        const merged = userPrefix ? [...server, userPrefix] : server;
        return [...new Set(merged)].sort((left, right) => right.length - left.length);
    }

    private closest(input: string): string | null {
        let best: string | null = null;
        let bestDistance = 3;
        for (const name of this.client.commands.keys()) {
            const distance = editDistance(input, name);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = name;
            }
        }
        return best;
    }

    private responder(message: Message<true>) {
        return async (content: string | MessageReplyOptions): Promise<Message> => {
            const sent = await message.reply(content);
            this.client.utils.scheduleDelete(this.client, sent);
            return sent;
        };
    }

    /**
     * The request channel treats unknown text as a song query. A real command
     * (including a mapping or custom alias) must still reach the normal path.
     */
    private async isSetupCommand(
        message: Message<true>,
        guildPrefix: string,
        userPrefix: string | null
    ): Promise<boolean> {
        const match = matchPrefixCommand(message.content, this.prefixList(guildPrefix, userPrefix));
        if (!match) return false;
        if (this.client.commands.has(match.name) || this.client.aliases.has(match.name)) {
            return true;
        }

        const mapping = await this.client.db
            .getCommandMapping(message.guildId, match.name, message.author.id)
            .catch(() => null);
        const expansion = mapping?.expansion.trim().split(/ +/)[0]?.toLowerCase();
        if (
            expansion &&
            (this.client.commands.has(expansion) || this.client.aliases.has(expansion))
        ) {
            return true;
        }

        const alias = await this.client.db
            .getCommandAlias(message.guildId, match.name, message.author.id)
            .catch(() => null);
        return Boolean(alias && this.client.commands.has(alias.command));
    }

    public async run(message: Message): Promise<unknown> {
        if (message.author.bot || !message.inGuild()) return;
        const me = message.guild.members.me;
        const member = message.member;
        const botId = this.client.user?.id;
        if (!me || !member || !botId) return;

        const reply = this.responder(message);
        const guild = await this.client.db.get(message.guildId);
        if (!guild) return;

        const userPrefix = await this.client.db.getUserPrefix(message.guildId, message.author.id);
        const setup = await this.client.db.getSetup(message.guildId);
        if (setup?.textId === message.channelId) {
            if (!(await this.isSetupCommand(message, guild.prefix, userPrefix))) {
                return this.client.emit('setupSystem', message);
            }
        }

        if (new RegExp(`^<@!?${botId}>( |)$`).test(message.content)) {
            return await reply({
                content: `Hey, my prefix for this server is \`${guild.prefix}\` Want more info? then do \`${guild.prefix}help\`\nStay Safe, Stay Awesome!`,
            });
        }

        const prefixes = this.prefixList(guild.prefix, userPrefix);
        const prefixPattern = new RegExp(
            `^(<@!?${botId}>|${prefixes.map(prefix => escapeRegex(prefix)).join('|')})\\s*`
        );
        const matchedPrefix = message.content.match(prefixPattern);
        if (!matchedPrefix) return;

        const args = message.content.slice(matchedPrefix[0].length).trim().split(/ +/g);
        let key = args.shift()?.toLowerCase();
        if (!key) return;
        const settings = await this.client.db.getGuildSettings(message.guildId);

        const mapping = await this.client.db.getCommandMapping(
            message.guildId,
            key,
            message.author.id
        );
        if (mapping) {
            const expanded = mapping.expansion.trim().split(/ +/g);
            const mapped = expanded.shift()?.toLowerCase();
            if (mapped) {
                key = mapped;
                args.unshift(...expanded);
            }
        }

        const aliasTarget = this.client.aliases.get(key);
        let command =
            this.client.commands.get(key) ??
            (aliasTarget ? this.client.commands.get(aliasTarget) : undefined);
        if (!command) {
            const customAlias = await this.client.db.getCommandAlias(
                message.guildId,
                key,
                message.author.id
            );
            if (customAlias) command = this.client.commands.get(customAlias.command);
        }

        if (!command && settings.autocorrect === 'true') {
            const suggestion = this.closest(key);
            const corrected = suggestion ? this.client.commands.get(suggestion) : undefined;
            if (suggestion && corrected) {
                command = corrected;
                const prefix = guild.prefix.split(',')[0]?.trim() || this.client.config.prefix;
                await reply({
                    content: `Corrected \`${prefix}${key}\` to \`${prefix}${suggestion}\`.`,
                });
                key = suggestion;
            }
        }
        if (!command) return;

        const gate = await evaluateCommand({
            client: this.client,
            command,
            guildId: message.guildId,
            guildName: message.guild.name,
            member: gateMember(member),
            me: gateMember(me),
            channel: message.channel,
            canViewChannel:
                message.channel.permissionsFor(me)?.has(PermissionFlagsBits.ViewChannel) === true,
            settings,
            args,
            commandKey: key,
            isPrefix: true,
        });
        if (!gate.ok) {
            if (gate.silent || !gate.response) return;
            if (gate.dm) return await message.author.send(gate.response).catch(() => {});
            return await reply(gate.response);
        }

        const ctx = new Context(message, args);
        ctx.deleteAfter = Number(settings.deleteafter) || null;
        ctx.setArgs(args);
        void this.client.db.recordCommand(message.guildId, command.name).catch(() => {});

        try {
            return await command.run(this.client, ctx, ctx.args);
        } catch (error) {
            this.client.logger.error(error);
            await reply({ content: `An error occurred: \`${error}\`` });
        }
    }
}
