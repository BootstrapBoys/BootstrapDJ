import {
    AutocompleteInteraction,
    ChatInputCommandInteraction,
    CommandInteraction,
    InteractionType,
    PermissionFlagsBits,
} from 'discord.js';
import { LoadType } from 'shoukaku';

import { BootstrapClient, Context, Event } from '../../core/index.js';
import { evaluateCommand } from '../../lib/CommandGate.js';
import { shouldReplyEphemeral } from '../../lib/ResponseMode.js';

type Choice = { name: string; value: string };
type PlaylistChoice = { name: string; songs: number };

const PLAYLIST_TTL = 5_000;
const SEARCH_TTL = 15_000;
const SEARCH_LIMIT = 150;

export default class InteractionCreate extends Event {
    private playlistCache = new Map<string, { at: number; data: PlaylistChoice[] }>();
    private searchCache = new Map<string, { at: number; data: Choice[] }>();

    public constructor(client: BootstrapClient, file: string) {
        super(client, file, { name: 'interactionCreate' });
    }

    private async playlists(userId: string): Promise<PlaylistChoice[]> {
        const cached = this.playlistCache.get(userId);
        if (cached && Date.now() - cached.at < PLAYLIST_TTL) return cached.data;
        const rows = await this.client.db.getPlaylists(userId);
        const data = rows.map(row => ({ name: row.name, songs: row._count.songs }));
        this.playlistCache.set(userId, { at: Date.now(), data });
        if (this.playlistCache.size > 200) {
            for (const [id, entry] of this.playlistCache) {
                if (Date.now() - entry.at >= PLAYLIST_TTL) this.playlistCache.delete(id);
            }
        }
        return data;
    }

    private async tracks(query: string): Promise<Choice[]> {
        const key = query.trim().toLowerCase();
        if (!key) return [];
        const cached = this.searchCache.get(key);
        if (cached && Date.now() - cached.at < SEARCH_TTL) return cached.data;

        const result = await this.client.queue.search(query);
        const data =
            result?.loadType === LoadType.SEARCH
                ? result.data.slice(0, 10).map(track => ({
                      name: `${track.info.title} by ${track.info.author}`.slice(0, 100),
                      value: `${track.info.uri}`.slice(0, 100),
                  }))
                : [];
        this.searchCache.set(key, { at: Date.now(), data });
        if (this.searchCache.size > SEARCH_LIMIT) {
            for (const [id, entry] of this.searchCache) {
                if (Date.now() - entry.at >= SEARCH_TTL) this.searchCache.delete(id);
            }
            for (const id of this.searchCache.keys()) {
                if (this.searchCache.size <= SEARCH_LIMIT) break;
                this.searchCache.delete(id);
            }
        }
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

    private async handleCommand(
        interaction: ChatInputCommandInteraction
    ): Promise<unknown> {
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
            args: [...interaction.options.data].map(option => String(option.value ?? '')),
            commandKey: interaction.commandName,
            isPrefix: false,
        });

        if (!gate.ok) {
            if (gate.silent || !gate.response) return;
            if (gate.dm) return await member.send(gate.response).catch(() => {});
            return await interaction.reply({ ...gate.response, ephemeral });
        }

        const ctx = new Context(interaction, [...interaction.options.data], ephemeral);
        ctx.deleteAfter = Number(settings.deleteafter) || null;
        ctx.setArgs(interaction.options.data);
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
            await command.run(this.client, ctx, ctx.args);
        } catch (error) {
            this.client.logger.error(error);
            const code =
                typeof error === 'object' && error !== null && 'code' in error
                    ? (error as { code?: unknown }).code
                    : undefined;
            if (code === 10062 || code === 40060) return;
            const content = `An error occurred: \`${error}\``;
            try {
                await (interaction.deferred || interaction.replied
                    ? interaction.editReply({ content })
                    : interaction.reply({ content, ephemeral }));
            } catch (replyError) {
                this.client.logger.error(`[interaction] error reply failed: ${replyError}`);
            }
        }
    }

    private async autocomplete(
        interaction: AutocompleteInteraction
    ): Promise<unknown> {
        const focused = interaction.options.getFocused(true);
        const query = String(focused.value ?? '').toLowerCase();

        if (interaction.commandName === 'guild' && focused.name === 'guild') {
            if (!this.client.config.owners.includes(interaction.user.id)) {
                return await this.respond(interaction, []);
            }
            return await this.respond(
                interaction,
                [...this.client.guilds.cache.values()]
                    .filter(guild => guild.name.toLowerCase().includes(query) || guild.id.includes(query))
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .slice(0, 25)
                    .map(guild => ({ name: `${guild.name} (${guild.id})`.slice(0, 100), value: guild.id }))
            );
        }

        if (interaction.commandName === 'playlist' && focused.name === 'query') {
            const term = focused.value.trim();
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
                        name: `${playlist.name} — ${playlist.songs} song${playlist.songs === 1 ? '' : 's'}`.slice(0, 100),
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
            interaction instanceof CommandInteraction &&
            interaction.type === InteractionType.ApplicationCommand
        ) {
            return await this.handleCommand(interaction);
        }
        if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
            return await this.autocomplete(interaction);
        }
        return undefined;
    }
}
