import {
    AutocompleteInteraction,
    ChatInputCommandInteraction,
    CommandInteraction,
    InteractionType,
    PermissionFlagsBits,
} from 'discord.js';
import { LoadType } from 'shoukaku';

import { BootstrapClient, Context, Event } from '../../structures/index.js';
import { evaluateCommand } from '../../utils/CommandGate.js';
import { shouldReplyEphemeral } from '../../utils/ResponseMode.js';

export default class InteractionCreate extends Event {
    private static readonly PLAYLIST_CACHE_MS = 5000;
    private static readonly SEARCH_CACHE_MS = 15000;
    private static readonly SEARCH_CACHE_MAX = 150;
    private playlistCache = new Map<
        string,
        { at: number; playlists: Array<{ name: string; songs: number }> }
    >();
    private searchCache = new Map<
        string,
        { at: number; choices: Array<{ name: string; value: string }> }
    >();

    constructor(client: BootstrapClient, file: string) {
        super(client, file, {
            name: 'interactionCreate',
        });
    }

    /**
     * Playlist names for autocomplete. Discord fires one request per keystroke,
     * so the user's list is cached briefly instead of one SQLite query each time.
     */
    private async playlistChoices(
        userId: string
    ): Promise<Array<{ name: string; songs: number }>> {
        const now = Date.now();
        const cached = this.playlistCache.get(userId);
        if (cached && now - cached.at < InteractionCreate.PLAYLIST_CACHE_MS) return cached.playlists;

        const playlists = await this.client.db.getPlaylists(userId);
        const entries = playlists.map(playlist => ({
            name: playlist.name,
            songs: playlist._count.songs,
        }));
        this.playlistCache.set(userId, { at: now, playlists: entries });

        // Bound the map: drop expired users instead of letting it grow.
        if (this.playlistCache.size > 200) {
            for (const [id, entry] of this.playlistCache) {
                if (now - entry.at >= InteractionCreate.PLAYLIST_CACHE_MS) this.playlistCache.delete(id);
            }
        }
        return entries;
    }

    /**
     * Track suggestions for /play and /playnext. Each keystroke used to trigger a
     * full Lavalink search; identical prefixes inside the TTL reuse one result.
     */
    private async searchChoices(query: string): Promise<Array<{ name: string; value: string }>> {
        const key = query.trim().toLowerCase();
        if (!key) return [];

        const now = Date.now();
        const cached = this.searchCache.get(key);
        if (cached && now - cached.at < InteractionCreate.SEARCH_CACHE_MS) return cached.choices;

        const res = await this.client.queue.search(query);
        let choices: Array<{ name: string; value: string }> = [];
        if (res && res.loadType === LoadType.SEARCH && res.data.length) {
            choices = res.data.slice(0, 10).map(track => ({
                // Discord caps choice name and value at 100 characters.
                name: `${track.info.title} by ${track.info.author}`.slice(0, 100),
                value: `${track.info.uri}`.slice(0, 100),
            }));
        }

        this.searchCache.set(key, { at: now, choices });
        if (this.searchCache.size > InteractionCreate.SEARCH_CACHE_MAX) {
            for (const [id, entry] of this.searchCache) {
                if (now - entry.at >= InteractionCreate.SEARCH_CACHE_MS) this.searchCache.delete(id);
            }
            // Still oversized (all entries fresh): drop oldest insertions.
            for (const id of this.searchCache.keys()) {
                if (this.searchCache.size <= InteractionCreate.SEARCH_CACHE_MAX) break;
                this.searchCache.delete(id);
            }
        }
        return choices;
    }

    public async run(interaction: ChatInputCommandInteraction | AutocompleteInteraction): Promise<unknown> {
        if (
            interaction instanceof CommandInteraction &&
            interaction.type === InteractionType.ApplicationCommand
        ) {
            const { commandName } = interaction;
            // Cached narrowing: guild, member and channel are non-null from here.
            if (!interaction.inCachedGuild()) return;
            const me = interaction.guild.members.me;
            const member = interaction.member;
            if (!me || !member) return;
            await this.client.db.get(interaction.guildId); // get or create guild data
            const command = this.client.commands.get(interaction.commandName);
            if (!command) return;
            const guildSettings = await this.client.db.getGuildSettings(interaction.guildId);
            const ephemeral = shouldReplyEphemeral(command.ephemeral, guildSettings);
            const channel = interaction.channel;
            if (!channel) return;
            const gateArgs = [...interaction.options.data].map(option =>
                String(option.value ?? '')
            );
            const gate = await evaluateCommand({
                client: this.client,
                command,
                guildId: interaction.guildId,
                guildName: interaction.guild.name,
                member: {
                    id: interaction.user.id,
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
                settings: guildSettings,
                args: gateArgs,
                commandKey: commandName,
                isPrefix: false,
            });
            if (!gate.ok) {
                if (gate.silent || !gate.response) return;
                if (gate.dm) {
                    await member.send(gate.response).catch(() => {});
                    return;
                }
                return await interaction.reply({ ...gate.response, ephemeral });
            }

            const ctx = new Context(interaction, [...interaction.options.data], ephemeral);
            ctx.deleteAfter = Number(guildSettings.deleteafter) || null;
            ctx.setArgs(interaction.options.data);

            if (command.defer) {
                try {
                    await ctx.defer(ephemeral);
                } catch (error) {
                    // The interaction can expire before the bot reaches this
                    // point; acknowledging again is impossible, so log and stop.
                    this.client.logger.error(`[interaction] defer failed: ${error}`);
                    return;
                }
            }
            void this.client.db.recordCommand(interaction.guildId, command.name).catch(() => {});
            try {
                await command.run(this.client, ctx, ctx.args);
            } catch (error) {
                this.client.logger.error(error);
                const code =
                    typeof error === 'object' && error !== null && 'code' in error
                        ? (error as { code?: unknown }).code
                        : undefined;
                // 10062 = the 3s token expired; 40060 = already acknowledged.
                // Trying to reply again here used to throw out of the handler,
                // reach antiCrash and restart the whole bot.
                if (code === 10062 || code === 40060) return;
                const payload = {
                    content: `An error occurred: \`${error}\``,
                    ephemeral,
                };
                try {
                    await (interaction.deferred || interaction.replied
                        ? interaction.editReply({ content: payload.content })
                        : interaction.reply(payload));
                } catch (replyError) {
                    this.client.logger.error(`[interaction] error reply failed: ${replyError}`);
                }
            }
        } else if (interaction.type == InteractionType.ApplicationCommandAutocomplete) {
            const focused = interaction.options.getFocused(true);

            // Playlist name suggestions for /add, /load and /delete.
            if (focused.name === 'playlist') {
                const query = String(focused.value ?? '').toLowerCase();
                const playlists = await this.playlistChoices(interaction.user.id);
                const choices = playlists
                    .filter(playlist => playlist.name.toLowerCase().includes(query))
                    .slice(0, 25)
                    .map(playlist => ({
                        // Discord caps both fields at 100 characters.
                        name: `${playlist.name} — ${playlist.songs} song${
                            playlist.songs === 1 ? '' : 's'
                        }`.slice(0, 100),
                        value: playlist.name.slice(0, 100),
                    }));
                try {
                    await interaction.respond(choices);
                } catch (error) {
                    this.client.logger.error(`[autocomplete] respond failed: ${error}`);
                }
                return;
            }

            if (interaction.commandName == 'play' || interaction.commandName == 'playnext') {
                const song = interaction.options.getString('song');
                if (!song) return await interaction.respond([]).catch(() => {});
                return await interaction
                    .respond(await this.searchChoices(song))
                    .catch(error => this.client.logger.error(`[autocomplete] respond failed: ${error}`));
            }

            // Always answer, otherwise Discord leaves the field "loading".
            return await interaction.respond([]).catch(() => {});
        }
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
