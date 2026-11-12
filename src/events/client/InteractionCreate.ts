import {
    AutocompleteInteraction,
    ChatInputCommandInteraction,
    InteractionType,
    PermissionFlagsBits,
} from 'discord.js';
import { LoadType } from 'shoukaku';

import { BootstrapClient, Context, Event } from '../../core/index.js';
import { evaluateCommand, isOwner } from '../../lib/CommandGate.js';
import { refreshStalePlayer } from '../../lib/PlayerResolver.js';
import { COMMAND_FAILURE_MESSAGE } from '../../lib/reply.js';
import { deleteAfterSeconds, shouldReplyEphemeral } from '../../lib/ResponseMode.js';

interface Choice {
    name: string;
    value: string;
}

interface PlaylistChoice {
    name: string;
    songs: number;
}

/** Small TTL cache; autocomplete can fire on every keystroke. */
class TtlCache<Key, Value> {
    private readonly entries = new Map<Key, { storedAt: number; value: Value }>();

    public constructor(
        private readonly ttlMs: number,
        private readonly limit: number,
        private readonly evictOldest: boolean
    ) {}

    public get(key: Key): Value | undefined {
        const entry = this.entries.get(key);
        if (!entry) return undefined;
        if (Date.now() - entry.storedAt >= this.ttlMs) {
            this.entries.delete(key);
            return undefined;
        }
        return entry.value;
    }

    public set(key: Key, value: Value): void {
        this.entries.set(key, { storedAt: Date.now(), value });
        this.prune();
    }

    private prune(): void {
        const now = Date.now();
        for (const [key, entry] of this.entries) {
            if (now - entry.storedAt >= this.ttlMs) this.entries.delete(key);
        }
        if (!this.evictOldest) return;
        while (this.entries.size > this.limit) {
            const oldest = this.entries.keys().next();
            if (oldest.done) break;
            this.entries.delete(oldest.value);
        }
    }
}

function errorCode(error: unknown): unknown {
    if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
    return error.code;
}

export default class InteractionCreate extends Event {
    private readonly playlistCache = new TtlCache<string, PlaylistChoice[]>(5_000, 200, false);
    private readonly searchCache = new TtlCache<string, Choice[]>(15_000, 150, true);

    public constructor(client: BootstrapClient, file: string) {
        super(client, file, { name: 'interactionCreate' });
    }

    private async playlists(userId: string): Promise<PlaylistChoice[]> {
        const cached = this.playlistCache.get(userId);
        if (cached) return cached;
        const rows = await this.client.db.getPlaylists(userId);
        const data = rows.map(row => ({ name: row.name, songs: row._count.songs }));
        this.playlistCache.set(userId, data);
        return data;
    }

    private async tracks(query: string): Promise<Choice[]> {
        const key = query.trim().toLowerCase();
        if (!key) return [];
        const cached = this.searchCache.get(key);
        if (cached) return cached;

        const result = await this.client.queue.search(query);
        const data =
            result?.loadType === LoadType.SEARCH
                ? result.data.slice(0, 10).map(track => ({
                      name: `${track.info.title} by ${track.info.author}`.slice(0, 100),
                      value: (track.info.uri ?? '').slice(0, 100),
                  }))
                : [];
        this.searchCache.set(key, data);
        return data;
    }

    private async respond(
        interaction: AutocompleteInteraction,
        choices: Choice[]
    ): Promise<unknown> {
        return await interaction
            .respond(choices)
            .catch(error => this.client.logger.error(`[autocomplete] respond failed: ${error}`));
    }

    private async handleCommand(interaction: ChatInputCommandInteraction): Promise<unknown> {
        if (!interaction.inCachedGuild()) return;
        const command = this.client.commands.get(interaction.commandName);
        if (!command) return;

        const me = interaction.guild.members.me;
        const member = interaction.member;
        const channel = interaction.channel;
        if (!me || !member || !channel) return;

        await this.client.db.get(interaction.guildId);
        const settings = await this.client.db.getGuildSettings(interaction.guildId);
        const ephemeral = shouldReplyEphemeral(command.ephemeral, settings);
        const rawArgs = [...interaction.options.data];
        const gate = await evaluateCommand({
            client: this.client,
            command,
            guildId: interaction.guildId,
            guildName: interaction.guild.name,
            member: {
                id: member.id,
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
            channel,
            canViewChannel:
                channel.permissionsFor(me)?.has(PermissionFlagsBits.ViewChannel) === true,
            settings,
            args: rawArgs.map(option => String(option.value ?? '')),
            commandKey: interaction.commandName,
            isPrefix: false,
            language: settings.language ?? this.client.config.defaultLanguage,
        });

        if (!gate.ok) {
            if (gate.silent || !gate.response) return;
            if (gate.dm) return await member.send(gate.response).catch(() => {});
            return await interaction.reply({ ...gate.response, ephemeral });
        }

        const ctx = new Context(interaction, rawArgs, ephemeral);
        ctx.setLanguage(settings.language ?? this.client.config.defaultLanguage);
        ctx.deleteAfter = deleteAfterSeconds(settings);

        if (command.defer) {
            try {
                await ctx.defer(ephemeral);
            } catch (error) {
                this.client.logger.error(`[interaction] defer failed: ${error}`);
                return;
            }
        }

        void this.client.db.recordCommand(interaction.guildId, command.name).catch(() => {});
        try {
            await refreshStalePlayer(
                this.client,
                command,
                interaction.guildId,
                member.voice.channel,
                channel
            );
            await command.run(this.client, ctx, ctx.args);
        } catch (error) {
            this.client.logger.error(error);
            const code = errorCode(error);
            if (code === 10062 || code === 40060) return;
            const content = COMMAND_FAILURE_MESSAGE;
            try {
                await (interaction.deferred || interaction.replied
                    ? interaction.editReply({ content })
                    : interaction.reply({ content, ephemeral }));
            } catch (replyError) {
                this.client.logger.error(`[interaction] error reply failed: ${replyError}`);
            }
        }
    }

    private async autocomplete(interaction: AutocompleteInteraction): Promise<unknown> {
        try {
            return await this.autocompleteChoices(interaction);
        } catch (error) {
            // An autocomplete request that rejects leaves Discord spinning
            // until it times out; answer with an empty list instead.
            this.client.logger.error(`[autocomplete] choice lookup failed: ${error}`);
            return await this.respond(interaction, []);
        }
    }

    private async autocompleteChoices(interaction: AutocompleteInteraction): Promise<unknown> {
        const focused = interaction.options.getFocused(true);
        const raw = focused.value ?? '';
        const query = String(raw).toLowerCase();

        if (interaction.commandName === 'guild' && focused.name === 'guild') {
            if (!isOwner(interaction.user.id, this.client.config.owners)) {
                return await this.respond(interaction, []);
            }
            return await this.respond(
                interaction,
                [...this.client.guilds.cache.values()]
                    .filter(
                        guild =>
                            guild.name.toLowerCase().includes(query) || guild.id.includes(query)
                    )
                    .sort((left, right) => left.name.localeCompare(right.name))
                    .slice(0, 25)
                    .map(guild => ({
                        name: `${guild.name} (${guild.id})`.slice(0, 100),
                        value: guild.id,
                    }))
            );
        }

        if (interaction.commandName === 'help' && focused.name === 'command') {
            const owner = isOwner(interaction.user.id, this.client.config.owners);
            const names = [...this.client.commands.values()]
                .filter(
                    command => owner || (command.category !== 'dev' && !command.permissions.dev)
                )
                .map(command => command.name)
                .filter(name => name.includes(query));
            const prefixMatches = names.filter(name => name.startsWith(query)).sort();
            const rest = names.filter(name => !name.startsWith(query)).sort();
            // Prefix matches read as the better guesses; 25 is Discord's cap.
            return await this.respond(
                interaction,
                [...prefixMatches, ...rest].slice(0, 25).map(name => ({ name, value: name }))
            );
        }

        if (interaction.commandName === 'playlist' && focused.name === 'query') {
            const term = String(raw).trim();
            return await this.respond(interaction, term ? await this.tracks(term) : []);
        }

        if (
            interaction.commandName === 'playlist' &&
            (focused.name === 'name' || focused.name === 'target')
        ) {
            const playlists = await this.playlists(interaction.user.id);
            return await this.respond(
                interaction,
                playlists
                    .filter(playlist => playlist.name.toLowerCase().includes(query))
                    .slice(0, 25)
                    .map(playlist => ({
                        name: `${playlist.name} — ${playlist.songs} song${
                            playlist.songs === 1 ? '' : 's'
                        }`.slice(0, 100),
                        value: playlist.name.slice(0, 100),
                    }))
            );
        }

        if (interaction.commandName === 'play' || interaction.commandName === 'playnext') {
            const song = interaction.options.getString('song');
            return await this.respond(interaction, song ? await this.tracks(song) : []);
        }
        return await this.respond(interaction, []);
    }

    public async run(
        interaction: ChatInputCommandInteraction | AutocompleteInteraction
    ): Promise<unknown> {
        if (
            interaction instanceof ChatInputCommandInteraction &&
            interaction.type === InteractionType.ApplicationCommand
        ) {
            return await this.handleCommand(interaction);
        }
        if (
            interaction instanceof AutocompleteInteraction &&
            interaction.type === InteractionType.ApplicationCommandAutocomplete
        ) {
            return await this.autocomplete(interaction);
        }
        return undefined;
    }
}
