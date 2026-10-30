import {
    AutocompleteInteraction,
    ChannelType,
    ChatInputCommandInteraction,
    Collection,
    CommandInteraction,
    InteractionType,
    PermissionFlagsBits,
} from 'discord.js';
import { LoadType } from 'shoukaku';

import { BootstrapClient, Context, Event } from '../../structures/index.js';

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
            const ctx = new Context(interaction, [...interaction.options.data]);
            ctx.setArgs(interaction.options.data);
            const channel = interaction.channel;
            if (!channel || channel.permissionsFor(me)?.has(PermissionFlagsBits.ViewChannel) !== true)
                return;

            if (!me.permissions.has(PermissionFlagsBits.SendMessages)) {
                return await member
                    .send({
                        content: `I don't have **\`SendMessage\`** permission in \`${interaction.guild.name}\`\nchannel: <#${interaction.channelId}>`,
                    })
                    .catch(() => { });
            }

            if (!me.permissions.has(PermissionFlagsBits.EmbedLinks))
                return await interaction.reply({
                    content: 'I don\'t have **`EmbedLinks`** permission.',
                });

            if (command.permissions) {
                if (command.permissions.client) {
                    if (!me.permissions.has(command.permissions.client))
                        return await interaction.reply({
                            content: 'I don\'t have enough permissions to execute this command.',
                        });
                }

                if (command.permissions.user) {
                    if (
                        !member.permissions.has(
                            command.permissions.user
                        )
                    ) {
                        await interaction.reply({
                            content: 'You don\'t have enough permissions to use this command.',
                            ephemeral: true,
                        });
                        return;
                    }
                }
                if (command.permissions.dev) {
                    if (this.client.config.owners) {
                        const findDev = this.client.config.owners.find(
                            x => x === interaction.user.id
                        );
                        if (!findDev) return;
                    }
                }
            }
            if (command.player) {
                if (command.player.voice) {
                    if (!member.voice.channel)
                        return await interaction.reply({
                            content: `You must be connected to a voice channel to use this \`${command.name}\` command.`,
                        });

                    if (!me.permissions.has(PermissionFlagsBits.Connect))
                        return await interaction.reply({
                            content: `I don't have \`CONNECT\` permissions to execute this \`${command.name}\` command.`,
                        });

                    if (!me.permissions.has(PermissionFlagsBits.Speak))
                        return await interaction.reply({
                            content: `I don't have \`SPEAK\` permissions to execute this \`${command.name}\` command.`,
                        });

                    if (
                        member.voice.channel.type ===
                        ChannelType.GuildStageVoice &&
                        !me.permissions.has(
                            PermissionFlagsBits.RequestToSpeak
                        )
                    )
                        return await interaction.reply({
                            content: `I don't have \`REQUEST TO SPEAK\` permission to execute this \`${command.name}\` command.`,
                        });
                    if (me.voice.channel) {
                        if (
                            me.voice.channelId !==
                            member.voice.channelId
                        )
                            return await interaction.reply({
                                content: `You are not connected to <#${me.voice.channel.id}> to use this \`${command.name}\` command.`,
                            });
                    }
                }
                if (command.player.active) {
                    const activePlayer = this.client.queue.get(interaction.guildId);
                    if (!activePlayer || !activePlayer.current)
                        return await interaction.reply({
                            content: 'Nothing is playing right now.',
                        });
                }
                if (command.player.dj) {
                    const dj = await this.client.db.getDj(interaction.guildId);
                    if (dj && dj.mode) {
                        const djRole = await this.client.db.getRoles(interaction.guildId);
                        if (!djRole)
                            return await interaction.reply({
                                content: 'DJ role is not set.',
                            });
                        const findDJRole = member.roles.cache.find(
                            (x: any) => djRole.map((y: any) => y.roleId).includes(x.id)
                        );
                        if (!findDJRole) {
                            if (
                                !member.permissions.has(
                                    PermissionFlagsBits.ManageGuild
                                )
                            ) {
                                return await interaction.reply({
                                    content: 'You need to have the DJ role to use this command.',
                                    ephemeral: true,
                                });
                            }
                        }
                    }
                }
            }
            let timestamps = this.client.cooldown.get(commandName);
            if (!timestamps) {
                timestamps = new Collection<string, number>();
                this.client.cooldown.set(commandName, timestamps);
            }
            const now = Date.now();

            const cooldownAmount = Math.floor(command.cooldown || 5) * 1000;
            if (!timestamps.has(interaction.user.id)) {
                timestamps.set(interaction.user.id, now);
                setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);
            } else {
                const expirationTime = (timestamps.get(interaction.user.id) ?? now) + cooldownAmount;
                const timeLeft = (expirationTime - now) / 1000;
                if (now < expirationTime && timeLeft > 0.9) {
                    return await interaction.reply({
                        content: `Please wait ${timeLeft.toFixed(
                            1
                        )} more second(s) before reusing the \`${commandName}\` command.`,
                    });
                }
                timestamps.set(interaction.user.id, now);
                setTimeout(() => timestamps.delete(interaction.user.id), cooldownAmount);
            }
            if (
                interaction.options.data.some(
                    option => option.value && option.value.toString().includes('@everyone')
                ) ||
                interaction.options.data.some(
                    option => option.value && option.value.toString().includes('@here')
                )
            )
                return await interaction.reply({
                    content: 'You can\'t mention everyone or here.',
                    ephemeral: true,
                });
            if (command.defer) await ctx.defer();
            try {
                await command.run(this.client, ctx, ctx.args);
            } catch (error) {
                this.client.logger.error(error);
                const payload = { content: `An error occurred: \`${error}\`` };
                await (interaction.deferred || interaction.replied
                    ? interaction.editReply(payload)
                    : interaction.reply(payload));
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
