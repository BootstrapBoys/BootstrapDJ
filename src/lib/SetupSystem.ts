import {
    ActionRowBuilder,
    AttachmentBuilder,
    BaseGuildTextChannel,
    ButtonBuilder,
    ButtonInteraction,
    ColorResolvable,
    EmbedBuilder,
    Guild,
    Message,
    StringSelectMenuInteraction,
} from 'discord.js';
import { existsSync } from 'node:fs';
import { LoadType } from 'shoukaku';

import type { Song } from '../core/Dispatcher.js';
import { BootstrapClient, Dispatcher } from '../core/index.js';
import { getButtons } from './Buttons.js';
import { checkTrack, getPlayLimits } from './PlayLimits.js';

const LIVE_BADGE_PATH = '/root/EarlTheEar/assets/live.png';
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
const MOCK_PURGE_PASSES = 10;

type SetupInteraction = ButtonInteraction<'cached'> | StringSelectMenuInteraction<'cached'>;

interface MockPayload {
    embeds: EmbedBuilder[];
    files?: AttachmentBuilder[];
    attachments?: [];
    components?: ActionRowBuilder<ButtonBuilder>[];
}

/** The listener app owns this state; the database stays the single source. */
async function listeningActive(client: BootstrapClient, guildId: string): Promise<boolean> {
    const state = await client.db.getVoiceListen(guildId);
    return state?.enabled === true;
}

/** Prefer a guild emoji URL, then the bundled PNG, for the LIVE badge. */
function withLiveBadge(client: BootstrapClient, embed: EmbedBuilder): MockPayload {
    if (client.config.earlLiveBadgeUrl) {
        return { embeds: [embed.setThumbnail(client.config.earlLiveBadgeUrl)] };
    }
    if (!existsSync(LIVE_BADGE_PATH)) return { embeds: [embed] };
    return {
        embeds: [embed.setThumbnail('attachment://earl-live.png')],
        files: [new AttachmentBuilder(LIVE_BADGE_PATH, { name: 'earl-live.png' })],
        attachments: [],
    };
}

function mockComponents(hasCurrent: boolean): ActionRowBuilder<ButtonBuilder>[] {
    return getButtons().map(row => {
        for (const control of row.components) control.setDisabled(!hasCurrent);
        return row;
    });
}

function sourceIcon(client: BootstrapClient, sourceName: string): string | undefined {
    return client.config.icons[sourceName] ?? client.user?.displayAvatarURL({ extension: 'png' });
}

function nowPlayingEmbed(
    client: BootstrapClient,
    track: Song,
    variant: 'mock' | 'request'
): EmbedBuilder {
    const requestedBy = track.info.requester;
    const author = variant === 'request' ? ` by ${track.info.author}` : '';
    const artwork =
        track.info.artworkUrl ?? (variant === 'request' ? client.config.links.img : null);
    return client
        .embed()
        .setAuthor({ name: 'Now Playing', iconURL: sourceIcon(client, track.info.sourceName) })
        .setColor(client.color.main)
        .setDescription(
            `[${track.info.title}](${track.info.uri})${author} - \`[${client.utils.formatTime(
                track.info.length
            )}]\` - Requested by ${requestedBy}`
        )
        .setImage(artwork);
}

function idleEmbed(client: BootstrapClient): EmbedBuilder {
    return client
        .embed()
        .setColor(client.color.main)
        .setAuthor({
            name: client.user?.username ?? 'BootstrapDJ',
            iconURL: client.user?.displayAvatarURL({ extension: 'png' }),
        })
        .setDescription('Nothing playing right now')
        .setImage(client.config.links.img);
}

function expire(client: BootstrapClient, message: Message): void {
    const seconds = client.config.deleteAfter;
    if (!seconds || seconds <= 0) return;
    const timer = setTimeout(() => {
        void message.delete().catch(() => {});
    }, seconds * 1000);
    timer.unref();
}

async function sendTransient(
    client: BootstrapClient,
    channel: BaseGuildTextChannel,
    description: string,
    color: ColorResolvable
): Promise<void> {
    const message = await channel
        .send({ embeds: [client.embed().setColor(color).setDescription(description)] })
        .catch(() => null);
    if (message) expire(client, message);
}

async function fetchMock(
    channel: BaseGuildTextChannel,
    messageId: string
): Promise<Message | undefined> {
    return await channel.messages.fetch({ message: messageId, cache: true }).catch(() => undefined);
}

function mockRender(
    client: BootstrapClient,
    embed: EmbedBuilder,
    listening: boolean,
    hasCurrent: boolean
): MockPayload {
    const components = mockComponents(hasCurrent);
    return listening
        ? { ...withLiveBadge(client, embed), components }
        : { embeds: [embed], components, attachments: [] };
}

async function refreshMock(
    client: BootstrapClient,
    message: Message,
    player: Dispatcher
): Promise<void> {
    const guildId = message.guildId;
    if (!guildId) return;
    const listening = await listeningActive(client, guildId);
    const embed = player.current
        ? nowPlayingEmbed(client, player.current, 'mock')
        : idleEmbed(client);
    await message
        .edit(mockRender(client, embed, listening, Boolean(player.current)))
        .catch(error => client.logger.error(`[setup] mock edit failed: ${error}`));
}

async function enqueueSingle(
    client: BootstrapClient,
    player: Dispatcher,
    message: Message<true>,
    channel: BaseGuildTextChannel,
    track: Song,
    limits: Awaited<ReturnType<typeof getPlayLimits>>
): Promise<boolean> {
    const rejection = checkTrack(player, track, message.author.id, limits);
    if (rejection) {
        await sendTransient(client, channel, rejection, client.color.red);
        return false;
    }
    player.enqueue(track);
    await player.isPlaying();
    await sendTransient(
        client,
        channel,
        `Added [${track.info.title}](${track.info.uri}) to the queue.`,
        client.color.main
    );
    return true;
}

async function setupStart(
    client: BootstrapClient,
    query: string,
    player: Dispatcher,
    message: Message<true>
): Promise<void> {
    const data = await client.db.getSetup(message.guild.id);
    if (!data) return;
    const channel = message.channel;
    if (!(channel instanceof BaseGuildTextChannel)) return;
    const mock = await fetchMock(channel, data.messageId);
    if (!mock) return;

    try {
        const limits = await getPlayLimits(client, player.guildId);
        const result = await client.queue.search(query, client.config.prefixSearchEngine);
        if (!result) {
            return await sendTransient(
                client,
                channel,
                'There was an error while searching. Please try again.',
                client.color.red
            );
        }

        if (result.loadType === LoadType.ERROR) {
            return await sendTransient(
                client,
                channel,
                'There was an error while searching.',
                client.color.red
            );
        }
        if (result.loadType === LoadType.EMPTY) {
            return await sendTransient(
                client,
                channel,
                'There were no results found.',
                client.color.red
            );
        }

        if (result.loadType === LoadType.TRACK || result.loadType === LoadType.SEARCH) {
            const raw = result.loadType === LoadType.TRACK ? result.data : result.data[0];
            if (!raw) return;
            const track = player.buildTrack(raw, message.author);
            if (!(await enqueueSingle(client, player, message, channel, track, limits))) return;
            const shown = player.current;
            if (shown) {
                await mock
                    .edit({ embeds: [nowPlayingEmbed(client, shown, 'request')] })
                    .catch(() => {});
            }
            return;
        }

        if (result.loadType !== LoadType.PLAYLIST) return;
        if (result.data.tracks.length > client.config.maxPlaylistSize) {
            return await sendTransient(
                client,
                channel,
                `The playlist is too long. The maximum length is ${client.config.maxPlaylistSize} songs.`,
                client.color.red
            );
        }

        let accepted = 0;
        const wanted = result.data.tracks.slice(0, limits.maxPlaylistTracks || undefined);
        for (const raw of wanted) {
            const track = player.buildTrack(raw, message.author);
            if (checkTrack(player, track, message.author.id, limits)) continue;
            player.enqueue(track, true, false);
            accepted += 1;
        }
        void player.persist();
        await player.isPlaying();
        const skipped = wanted.length - accepted;
        await sendTransient(
            client,
            channel,
            `Added ${accepted} track${accepted === 1 ? '' : 's'} to the queue${
                skipped > 0 ? ` (${skipped} skipped)` : ''
            }.`,
            client.color.main
        );

        // The panel mirrors what is actually playing; the first requested
        // track is only current if playback was idle when the playlist landed.
        const shown = player.current;
        if (shown) {
            await mock
                .edit({ embeds: [nowPlayingEmbed(client, shown, 'request')] })
                .catch(() => {});
        }
    } catch (error) {
        client.logger.error(error);
        await sendTransient(
            client,
            channel,
            'Something went wrong while adding that request. Please try again.',
            client.color.red
        );
    }
}

async function trackStart(
    msgId: string,
    channel: BaseGuildTextChannel,
    player: Dispatcher,
    track: Song,
    client: BootstrapClient
): Promise<void> {
    if (!player.current) return;
    const mock = await fetchMock(channel, msgId);
    if (mock) {
        await refreshMock(client, mock, player);
        return;
    }

    const message = await channel
        .send({
            embeds: [nowPlayingEmbed(client, track, 'mock')],
            components: mockComponents(Boolean(player.current)),
        })
        .catch(() => null);
    if (!message) return;
    client.logger.warn(
        `[setup] mock message ${msgId} was not fetchable in ${channel.id}; posted a new one ${message.id}`
    );
    await client.db.setSetup(channel.guild.id, channel.id, message.id);
}

async function updateSetup(client: BootstrapClient, guild: Guild): Promise<void> {
    const setup = await client.db.getSetup(guild.id);
    if (!setup?.textId) return;
    const channel = guild.channels.cache.get(setup.textId);
    if (!(channel instanceof BaseGuildTextChannel)) return;
    const mock = await fetchMock(channel, setup.messageId);
    if (!mock) return;

    const player = client.queue.get(guild.id);
    if (player?.current) {
        await refreshMock(client, mock, player);
        return;
    }
    const listening = await listeningActive(client, guild.id);
    await mock.edit(mockRender(client, idleEmbed(client), listening, false)).catch(() => {});
}

async function buttonReply(
    interaction: SetupInteraction,
    text: string,
    color: ColorResolvable
): Promise<void> {
    const payload = { embeds: [new EmbedBuilder().setColor(color).setDescription(text)] };
    // A defer is not a reply: `followUp()` would add a second message and leave
    // the deferred "thinking" placeholder up forever. Edit the deferred reply.
    const message =
        interaction.deferred || interaction.replied
            ? await interaction.editReply(payload).catch(() => null)
            : await interaction.reply(payload).catch(() => null);
    if (!message) return;

    const timer = setTimeout(() => {
        if (!interaction.ephemeral) void message.delete().catch(() => {});
    }, 2000);
    timer.unref();
}

async function oops(channel: BaseGuildTextChannel, text: string): Promise<void> {
    try {
        const message = await channel.send({
            embeds: [new EmbedBuilder().setColor('Red').setDescription(text)],
        });
        const timer = setTimeout(() => {
            void message.delete().catch(() => {});
        }, 12_000);
        timer.unref();
    } catch (error) {
        console.error(error);
    }
}

const setupJanitors = new Map<string, NodeJS.Timeout>();

/** Empty the request channel and post a fresh idle mock once per boot. */
export async function resetSetupChannel(
    client: BootstrapClient,
    setup: { guildId: string; textId: string }
): Promise<void> {
    const guild = client.guilds.cache.get(setup.guildId);
    const channel = guild?.channels.cache.get(setup.textId);
    if (!guild || !(channel instanceof BaseGuildTextChannel)) return;

    const removed = await purgeRequestChannel(client, channel);

    try {
        const listening = await listeningActive(client, guild.id);
        const message = await channel.send(mockRender(client, idleEmbed(client), listening, false));
        await client.db.setSetup(guild.id, channel.id, message.id);
    } catch (error) {
        client.logger.error(`[setup] could not post a fresh mock in ${channel.id}: ${error}`);
    }
    client.logger.info(`[setup] ${channel.name}: purged ${removed} messages`);
}

async function purgeRequestChannel(
    client: BootstrapClient,
    channel: BaseGuildTextChannel
): Promise<number> {
    let removed = 0;
    try {
        for (let pass = 0; pass < MOCK_PURGE_PASSES; pass++) {
            const messages = await channel.messages.fetch({ limit: 100 });
            if (!messages.size) break;
            const recent = messages.filter(
                message => Date.now() - message.createdTimestamp < TWO_WEEKS_MS
            );
            if (!recent.size) break;
            removed += (await channel.bulkDelete(recent, true)).size;
            if (messages.size < 100) break;
        }
    } catch (error) {
        client.logger.error(`[setup] purge of ${channel.id} failed: ${error}`);
    }
    return removed;
}

export function stopSetupJanitor(guildId: string): void {
    const timer = setupJanitors.get(guildId);
    if (!timer) return;
    clearInterval(timer);
    setupJanitors.delete(guildId);
}

export function startSetupJanitor(client: BootstrapClient, guildId: string): void {
    const seconds = client.config.setupCleanupInterval;
    if (!seconds || seconds <= 0) return;
    const existing = setupJanitors.get(guildId);
    if (existing) clearInterval(existing);

    const timer = setInterval(async () => {
        try {
            const setup = await client.db.getSetup(guildId);
            if (!setup) {
                stopSetupJanitor(guildId);
                return;
            }
            const guild = client.guilds.cache.get(guildId);
            const channel = guild?.channels.cache.get(setup.textId);
            if (!(channel instanceof BaseGuildTextChannel)) return;

            const messages = await channel.messages.fetch({ limit: 50 });
            const player = client.queue.get(guildId);
            const graceMs = Math.max(5000, (client.config.deleteAfter || 0) * 1000);
            const stale = messages.filter(
                message =>
                    message.id !== setup.messageId &&
                    !message.author.bot &&
                    !message.pinned &&
                    !player?.hasTrackScopedNowPlayingMessage(message.id) &&
                    Date.now() - message.createdTimestamp > graceMs
            );
            if (!stale.size) return;

            const recent = stale.filter(
                message => Date.now() - message.createdTimestamp < TWO_WEEKS_MS
            );
            if (recent.size) await channel.bulkDelete(recent, true).catch(() => {});
            for (const message of stale.values()) {
                if (recent.has(message.id)) continue;
                await message.delete().catch(() => {});
            }
        } catch (error) {
            client.logger.error(`[setup] janitor failed for ${guildId}: ${error}`);
        }
    }, seconds * 1000);
    timer.unref();
    setupJanitors.set(guildId, timer);
}

export { setupStart, trackStart, buttonReply, updateSetup, oops };
