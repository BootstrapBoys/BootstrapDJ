import {
    ActionRowBuilder,
    AttachmentBuilder,
    ButtonBuilder,
    ButtonInteraction,
    ColorResolvable,
    EmbedBuilder,
    Guild,
    Message,
    StringSelectMenuInteraction,
    TextChannel,
} from 'discord.js';
import { existsSync } from 'node:fs';
import { LoadType } from 'shoukaku';

import { getButtons } from './Buttons.js';
import { checkTrack, getPlayLimits } from './PlayLimits.js';
import { Song } from '../core/Dispatcher.js';
import { BootstrapClient, Dispatcher } from '../core/index.js';

const LIVE_BADGE_PATH = '/root/EarlTheEar/assets/live.png';
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;

type SetupInteraction = ButtonInteraction<'cached'> | StringSelectMenuInteraction<'cached'>;
type MockPayload = {
    embeds: EmbedBuilder[];
    files?: AttachmentBuilder[];
    attachments?: [];
};

/** The listener owns this state; the database is the single source for the badge. */
async function listeningActive(client: BootstrapClient, guildId: string): Promise<boolean> {
    const state = await client.db.getVoiceListen(guildId);
    return state?.enabled === true;
}

function badgeFile(): AttachmentBuilder | null {
    return existsSync(LIVE_BADGE_PATH)
        ? new AttachmentBuilder(LIVE_BADGE_PATH, { name: 'earl-live.png' })
        : null;
}

/** Prefer a guild emoji URL, then the bundled PNG, for the LIVE thumbnail. */
function withLiveBadge(client: BootstrapClient, embed: EmbedBuilder): MockPayload {
    if (client.config.earlLiveBadgeUrl) {
        return { embeds: [embed.setThumbnail(client.config.earlLiveBadgeUrl)] };
    }
    const file = badgeFile();
    if (!file) return { embeds: [embed] };
    return {
        embeds: [embed.setThumbnail('attachment://earl-live.png')],
        files: [file],
        attachments: [],
    };
}

function mockComponents(hasCurrent: boolean): ActionRowBuilder<ButtonBuilder>[] {
    return getButtons().map(row => {
        for (const component of row.components) component.setDisabled(!hasCurrent);
        return row;
    });
}

function sourceIcon(client: BootstrapClient, sourceName: string): string | undefined {
    return (
        client.config.icons[sourceName] ??
        client.user?.displayAvatarURL({ extension: 'png' })
    );
}

function nowPlayingEmbed(
    client: BootstrapClient,
    track: Song,
    variant: 'mock' | 'request'
): EmbedBuilder {
    const suffix = variant === 'request' ? ` by ${track.info.author}` : '';
    return client
        .embed()
        .setAuthor({ name: 'Now Playing', iconURL: sourceIcon(client, track.info.sourceName) })
        .setColor(client.color.main)
        .setDescription(
            `[${track.info.title}](${track.info.uri})${suffix} - \`[${client.utils.formatTime(
                track.info.length
            )}]\` - Requested by ${track.info.requester}`
        )
        .setImage(track.info.artworkUrl ?? (variant === 'request' ? client.config.links.img : null));
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
        message.delete().catch(() => {});
    }, seconds * 1000);
    (timer as unknown as { unref?: () => void }).unref?.();
}

async function sendTransient(
    client: BootstrapClient,
    channel: TextChannel,
    description: string,
    color: ColorResolvable
): Promise<void> {
    const message = await channel
        .send({ embeds: [client.embed().setColor(color).setDescription(description)] })
        .catch(() => null);
    if (message) expire(client, message);
}

async function fetchMock(channel: TextChannel, messageId: string): Promise<Message | undefined> {
    return await channel.messages.fetch({ message: messageId, cache: true }).catch(() => undefined);
}

async function refreshMock(
    client: BootstrapClient,
    channel: TextChannel,
    message: Message,
    player: Dispatcher
): Promise<void> {
    const listening = await listeningActive(client, channel.guild.id);
    const embed = player.current
        ? nowPlayingEmbed(client, player.current, 'mock')
        : idleEmbed(client);
    const components = mockComponents(Boolean(player.current));
    await message
        .edit(
            listening
                ? { ...withLiveBadge(client, embed), components }
                : { embeds: [embed], components, attachments: [] }
        )
        .catch(error => client.logger.error(`[setup] mock edit failed: ${error}`));
}

async function enqueueSingle(
    client: BootstrapClient,
    player: Dispatcher,
    message: Message<true>,
    track: Song,
    limits: Awaited<ReturnType<typeof getPlayLimits>>
): Promise<boolean> {
    const rejection = checkTrack(player, track, message.author.id, limits);
    if (rejection) {
        await sendTransient(client, message.channel as TextChannel, rejection, client.color.red);
        return false;
    }
    if (player.queue.length >= client.config.maxQueueSize) {
        await sendTransient(
            client,
            message.channel as TextChannel,
            `The queue is too long. The maximum length is ${client.config.maxQueueSize} songs.`,
            client.color.red
        );
        return false;
    }
    player.enqueue(track);
    await player.isPlaying();
    await sendTransient(
        client,
        message.channel as TextChannel,
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
    const channel = message.channel as TextChannel;
    const mock = await fetchMock(channel, data.messageId);
    if (!mock) return;

    try {
        const limits = await getPlayLimits(client, player.guildId);
        const result = await client.queue.search(query, client.config.prefixSearchEngine);
        if (!result) return;

        if (result.loadType === LoadType.ERROR) {
            return await sendTransient(client, channel, 'There was an error while searching.', client.color.red);
        }
        if (result.loadType === LoadType.EMPTY) {
            return await sendTransient(client, channel, 'There were no results found.', client.color.red);
        }

        if (result.loadType === LoadType.TRACK || result.loadType === LoadType.SEARCH) {
            const raw = result.loadType === LoadType.TRACK ? result.data : result.data[0];
            const track = player.buildTrack(raw, message.author);
            if (!(await enqueueSingle(client, player, message, track, limits))) return;
            await mock.edit({ embeds: [nowPlayingEmbed(client, track, 'request')] }).catch(() => {});
            return;
        }

        if (result.loadType === LoadType.PLAYLIST) {
            if (result.data.tracks.length > client.config.maxPlaylistSize) {
                return await sendTransient(
                    client,
                    channel,
                    `The playlist is too long. The maximum length is ${client.config.maxPlaylistSize} songs.`,
                    client.color.red
                );
            }
            for (const raw of result.data.tracks.slice(0, limits.maxPlaylistTracks || undefined)) {
                const track = player.buildTrack(raw, message.author);
                if (checkTrack(player, track, message.author.id, limits)) break;
                if (player.queue.length >= client.config.maxQueueSize) {
                    await sendTransient(
                        client,
                        channel,
                        `The queue is too long. The maximum length is ${client.config.maxQueueSize} songs.`,
                        client.color.red
                    );
                    return;
                }
                player.enqueue(track, true, false);
            }
            void player.persist();
            await player.isPlaying();
            await sendTransient(
                client,
                channel,
                `Added [${result.data.tracks.length}](${result.data.tracks[0]?.info.uri ?? ''}) to the queue.`,
                client.color.main
            );
            await mock
                .edit({ embeds: [nowPlayingEmbed(client, player.current ?? player.buildTrack(result.data.tracks[0], message.author), 'request')] })
                .catch(() => {});
        }
    } catch (error) {
        client.logger.error(error);
    }
}

async function trackStart(
    msgId: string,
    channel: TextChannel,
    player: Dispatcher,
    track: Song,
    client: BootstrapClient
): Promise<void> {
    if (!player.current) return;
    const mock = await fetchMock(channel, msgId);
    if (mock) {
        await refreshMock(client, channel, mock, player);
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
    await client.db.setSetup(message.guild.id, message.channel.id, message.id);
}

async function updateSetup(client: BootstrapClient, guild: Guild): Promise<void> {
    const setup = await client.db.getSetup(guild.id);
    if (!setup?.textId) return;
    const channel = guild.channels.cache.get(setup.textId) as TextChannel | undefined;
    if (!channel) return;
    const mock = await fetchMock(channel, setup.messageId);
    if (!mock) return;
    const player = client.queue.get(guild.id);
    if (player?.current) {
        await refreshMock(client, channel, mock, player);
        return;
    }
    const listening = await listeningActive(client, guild.id);
    await mock
        .edit(
            listening
                ? { ...withLiveBadge(client, idleEmbed(client)), components: mockComponents(false) }
                : { embeds: [idleEmbed(client)], components: mockComponents(false), attachments: [] }
        )
        .catch(() => {});
}

async function buttonReply(
    interaction: SetupInteraction,
    text: string,
    color: ColorResolvable
): Promise<void> {
    const payload = { embeds: [new EmbedBuilder().setColor(color).setDescription(text)] };
    const message = interaction.replied
        ? await interaction.editReply(payload).catch(() => null)
        : await interaction.followUp(payload).catch(() => null);
    setTimeout(() => {
        if (message && !interaction.ephemeral) void message.delete().catch(() => {});
    }, 2000);
}

async function oops(channel: TextChannel, text: string): Promise<void> {
    try {
        const message = await channel.send({
            embeds: [new EmbedBuilder().setColor('Red').setDescription(text)],
        });
        const timer = setTimeout(() => {
            message.delete().catch(() => {});
        }, 12000);
        (timer as unknown as { unref?: () => void }).unref?.();
    } catch (error) {
        console.error(error);
    }
}

const setupJanitors = new Map<string, ReturnType<typeof setInterval>>();

/** Empty the request channel and post a fresh idle mock once per boot. */
export async function resetSetupChannel(
    client: BootstrapClient,
    setup: { guildId: string; textId: string }
): Promise<void> {
    const guild = client.guilds.cache.get(setup.guildId);
    const channel = guild?.channels.cache.get(setup.textId) as TextChannel | undefined;
    if (!guild || !channel) return;

    let removed = 0;
    try {
        for (let pass = 0; pass < 10; pass++) {
            const messages = await channel.messages.fetch({ limit: 100 });
            if (!messages.size) break;
            const recent = messages.filter(message => Date.now() - message.createdTimestamp < TWO_WEEKS_MS);
            if (!recent.size) break;
            removed += (await channel.bulkDelete(recent, true)).size;
            if (messages.size < 100) break;
        }
    } catch (error) {
        client.logger.error(`[setup] purge of ${channel.id} failed: ${error}`);
    }

    try {
        const embed = idleEmbed(client);
        const listening = await listeningActive(client, guild.id);
        const message = await channel.send(
            listening
                ? { ...withLiveBadge(client, embed), components: mockComponents(false) }
                : { embeds: [embed], components: mockComponents(false) }
        );
        await client.db.setSetup(guild.id, channel.id, message.id);
    } catch (error) {
        client.logger.error(`[setup] could not post a fresh mock in ${channel.id}: ${error}`);
    }
    client.logger.info(`[setup] ${channel.name}: purged ${removed} messages`);
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
            const channel = guild?.channels.cache.get(setup.textId) as TextChannel | undefined;
            if (!channel) return;
            const messages = await channel.messages.fetch({ limit: 50 });
            const player = client.queue.get(guildId);
            const stale = messages.filter(
                message =>
                    message.id !== setup.messageId &&
                    !message.author.bot &&
                    !message.pinned &&
                    !player?.hasTrackScopedNowPlayingMessage(message.id) &&
                    Date.now() - message.createdTimestamp >
                        Math.max(5000, (client.config.deleteAfter || 0) * 1000)
            );
            if (!stale.size) return;
            const recent = stale.filter(message => Date.now() - message.createdTimestamp < TWO_WEEKS_MS);
            if (recent.size) await channel.bulkDelete(recent, true).catch(() => {});
            for (const message of stale.filter(entry => !recent.has(entry.id)).values()) {
                await message.delete().catch(() => {});
            }
        } catch (error) {
            client.logger.error(`[setup] janitor failed for ${guildId}: ${error}`);
        }
    }, seconds * 1000);
    (timer as unknown as { unref?: () => void }).unref?.();
    setupJanitors.set(guildId, timer);
}

export { setupStart, trackStart, buttonReply, updateSetup, oops };
