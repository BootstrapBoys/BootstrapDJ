/* eslint-disable no-case-declarations */
import {
    AttachmentBuilder,
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

/** The listener owns this state; DB is the single source for the embed badge. */
async function listeningActive(client: BootstrapClient, guildId: string): Promise<boolean> {
    const state = await client.db.getVoiceListen(guildId);
    return state?.enabled === true;
}

function badgeFile(): AttachmentBuilder | null {
    if (!existsSync(LIVE_BADGE_PATH)) return null;
    return new AttachmentBuilder(LIVE_BADGE_PATH, { name: 'earl-live.png' });
}

/** LIVE thumbnail on the mock player: a guild-emoji URL when configured, else
 * the bundled PNG attached to the message (guilds with no free emoji slots). */
function withLiveBadge(client: BootstrapClient, embed: EmbedBuilder): {
    embeds: EmbedBuilder[];
    files?: AttachmentBuilder[];
    attachments?: [];
} {
    const url = client.config.earlLiveBadgeUrl;
    if (url) return { embeds: [embed.setThumbnail(url)] };
    const file = badgeFile();
    if (!file) return { embeds: [embed] };
    return {
        embeds: [embed.setThumbnail('attachment://earl-live.png')],
        files: [file],
        attachments: [],
    };
}

function neb(embed: EmbedBuilder, player: Dispatcher, client: BootstrapClient): EmbedBuilder {
    
    if (!player || !player.current || !player.current.info) return embed;

    let iconUrl: string | undefined = client.config.icons[player.current.info.sourceName];
    if (!iconUrl) iconUrl = client.user?.displayAvatarURL({ extension: 'png' });

    let icon = player.current ? player.current.info.artworkUrl : client.config.links.img;
    return embed
        .setAuthor({ name: 'Now Playing', iconURL: iconUrl })
        .setDescription(
            `[${player.current.info.title}](${player.current.info.uri}) by ${player.current.info.author
            } • \`[${client.utils.formatTime(player.current.info.length)}]\` - Requested by ${player.current.info.requester
            }`
        )
        .setImage(icon ?? null)
        .setColor(client.color.main);
}

/** Delete a message after COMMAND_DELETE_AFTER seconds (0 keeps it). */
function scheduleExpire(client: BootstrapClient, message: Message): void {
    const seconds = client.config.deleteAfter;
    if (!seconds || seconds <= 0) return;
    const timer = setTimeout(() => {
        message.delete().catch(() => {});
    }, seconds * 1000);
    (timer as unknown as { unref?: () => void }).unref?.();
}

async function setupStart(
    client: BootstrapClient,
    query: string,
    player: Dispatcher,
    message: Message<true>
): Promise<void> {
    let m: Message | undefined;
    const embed = client.embed();
    let n = client.embed().setColor(client.color.main);

    const data = await client.db.getSetup(message.guild.id);
    try {
        if (data)
            m = await message.channel.messages.fetch({ message: data.messageId, cache: true });
    } catch (error) {
        client.logger.error(error);
    }
    if (m) {
        try {
            const limits = await getPlayLimits(client, player.guildId);
            let res = await client.queue.search(query, client.config.prefixSearchEngine);
            if (!res) return;
            switch (res.loadType) {
                case LoadType.ERROR:
                    await message.channel
                        .send({
                            embeds: [
                                embed
                                    .setColor(client.color.red)
                                    .setDescription('There was an error while searching.'),
                            ],
                        })
                        .then(msg => scheduleExpire(client, msg));
                    break;
                case LoadType.EMPTY:
                    await message.channel
                        .send({
                            embeds: [
                                embed
                                    .setColor(client.color.red)
                                    .setDescription('There were no results found.'),
                            ],
                        })
                        .then(msg => scheduleExpire(client, msg));
                    break;
                case LoadType.TRACK:
                    const track = player.buildTrack(res.data, message.author);
                    const rejected = checkTrack(player, track, message.author.id, limits);
                    if (rejected) {
                        await message.channel
                            .send({
                                embeds: [
                                    embed.setColor(client.color.red).setDescription(rejected),
                                ],
                            })
                            .then(msg => scheduleExpire(client, msg));
                        return;
                    }

                    if (player.queue.length >= client.config.maxQueueSize) {
                        await message.channel
                            .send({
                                embeds: [
                                    embed
                                        .setColor(client.color.red)
                                        .setDescription(
                                            `The queue is too long. The maximum length is ${client.config.maxQueueSize} songs.`
                                        ),
                                ],
                            })
                            .then(msg => scheduleExpire(client, msg));
                        return;
                    }
                    player.enqueue(track);
                    await player.isPlaying();
                    await message.channel
                        .send({
                            embeds: [
                                embed
                                    .setColor(client.color.main)
                                    .setDescription(
                                        `Added [${res.data.info.title}](${res.data.info.uri}) to the queue.`
                                    ),
                            ],
                        })
                        .then(msg => scheduleExpire(client, msg));
                    neb(n, player, client);
                    if (m) await m.edit({ embeds: [n] }).catch(() => { });
                    break;
                case LoadType.PLAYLIST:
                    if (res.data.tracks.length > client.config.maxPlaylistSize) {
                        await message.channel
                            .send({
                                embeds: [
                                    embed
                                        .setColor(client.color.red)
                                        .setDescription(
                                            `The playlist is too long. The maximum length is ${client.config.maxPlaylistSize} songs.`
                                        ),
                                ],
                            })
                            .then(msg => scheduleExpire(client, msg));
                        return;
                    }
                    for (const track of res.data.tracks.slice(0, limits.maxPlaylistTracks || undefined)) {
                        const pl = player.buildTrack(track, message.author);
                        if (checkTrack(player, pl, message.author.id, limits)) break;
                        if (player.queue.length >= client.config.maxQueueSize) {
                            await message.channel
                                .send({
                                    embeds: [
                                        embed
                                            .setColor(client.color.red)
                                            .setDescription(
                                                `The queue is too long. The maximum length is ${client.config.maxQueueSize} songs.`
                                            ),
                                    ],
                                })
                                .then(msg => scheduleExpire(client, msg));
                            return;
                        }
                        player.enqueue(pl, true, false);
                    }
                    void player.persist();
                    await player.isPlaying();
                    await message.channel
                        .send({
                            embeds: [
                                embed
                                    .setColor(client.color.main)
                                    .setDescription(
                                        `Added [${res.data.tracks.length}](${res.data.tracks[0].info.uri}) to the queue.`
                                    ),
                            ],
                        })
                        .then(msg => scheduleExpire(client, msg));
                    neb(n, player, client);
                    if (m) await m.edit({ embeds: [n] }).catch(() => { });
                    break;
                case LoadType.SEARCH:
                    const track2 = player.buildTrack(res.data[0], message.author);
                    const rejected2 = checkTrack(player, track2, message.author.id, limits);
                    if (rejected2) {
                        await message.channel
                            .send({
                                embeds: [
                                    embed.setColor(client.color.red).setDescription(rejected2),
                                ],
                            })
                            .then(msg => scheduleExpire(client, msg));
                        return;
                    }
                    if (player.queue.length >= client.config.maxQueueSize) {
                        await message.channel
                            .send({
                                embeds: [
                                    embed
                                        .setColor(client.color.red)
                                        .setDescription(
                                            `The queue is too long. The maximum length is ${client.config.maxQueueSize} songs.`
                                        ),
                                ],
                            })
                            .then(msg => scheduleExpire(client, msg));
                        return;
                    }
                    player.enqueue(track2);
                    await player.isPlaying();
                    await message.channel
                        .send({
                            embeds: [
                                embed
                                    .setColor(client.color.main)
                                    .setDescription(
                                        `Added [${res.data[0].info.title}](${res.data[0].info.uri}) to the queue.`
                                    ),
                            ],
                        })
                        .then(msg => scheduleExpire(client, msg));
                    neb(n, player, client);
                    if (m) await m.edit({ embeds: [n] }).catch(() => { });
                    break;
            }
        } catch (error) {
            client.logger.error(error);
        }
    }
}
async function trackStart(
    msgId: string,
    channel: TextChannel,
    player: Dispatcher,
    track: Song,
    client: BootstrapClient
): Promise<void> {
    const current = player.current;
    if (!current) return;
    const icon = current.info.artworkUrl ?? client.config.links.img;
    let m: Message | undefined;
    try {
        m = await channel.messages.fetch({ message: msgId, cache: true });
    } catch (error) {
        client.logger.error(
            `[setup] could not fetch mock message ${msgId} in channel ${channel.id}: ${error}`
        );
    }
    if (m) {
        let iconUrl: string | undefined = client.config.icons[current.info.sourceName];
        if (!iconUrl) iconUrl = client.user?.displayAvatarURL({ extension: 'png' });
        const embed = client
            .embed()
            .setAuthor({ name: `Now Playing`, iconURL: iconUrl })
            .setColor(client.color.main)
            .setDescription(
                `[${track.info.title}](${track.info.uri}) - \`[${client.utils.formatTime(
                    track.info.length
                )}]\` - Requested by ${track.info.requester}`
            )
            .setImage(icon ?? null);
        const listening = await listeningActive(client, channel.guild.id);
        const components = getButtons().map(b => {
            b.components.forEach(c => {
                c.setDisabled(!player.current);
            });
            return b;
        });
        await m
            .edit(
                listening
                    ? { ...withLiveBadge(client, embed), components }
                    : { embeds: [embed], components, attachments: [] }
            )
            .catch(error => client.logger.error(`[setup] mock message edit failed: ${error}`));
    } else {
        let iconUrl: string | undefined = client.config.icons[current.info.sourceName];
        if (!iconUrl) iconUrl = client.user?.displayAvatarURL({ extension: 'png' });
        const embed = client
            .embed()
            .setColor(client.color.main)
            .setAuthor({ name: `Now Playing`, iconURL: iconUrl })
            .setDescription(
                `[${track.info.title}](${track.info.uri}) - \`[${client.utils.formatTime(
                    track.info.length
                )}]\` - Requested by ${track.info.requester}`
            )
            .setImage(icon ?? null);
        await channel
            .send({
                embeds: [embed],
                components: getButtons().map(b => {
                    b.components.forEach(c => {
                        c.setDisabled(!player.current);
                    });
                    return b;
                }),
            })
            .then(msg => {
                client.logger.warn(
                    `[setup] mock message ${msgId} was not fetchable in ${channel.id}; posted a new one ${msg.id}`
                );
                // setSetup(guildId, textId, messageId) — channel first, then message.
                client.db.setSetup(msg.guild.id, msg.channel.id, msg.id);
            })
            .catch(() => { });
    }
}

async function updateSetup(client: BootstrapClient, guild: Guild): Promise<void> {
    let setup = await client.db.getSetup(guild.id);
    let m: Message | undefined;
    if (setup && setup.textId) {
        const textChannel = guild.channels.cache.get(setup.textId) as TextChannel;
        if (!textChannel) return;
        try {
            m = await textChannel.messages.fetch({ message: setup.messageId, cache: true });
        } catch (error) {
            client.logger.error(error);
        }
    }
    if (m) {
        const player = client.queue.get(guild.id);
        if (player && player.current) {
            let iconUrl: string | undefined = client.config.icons[player.current.info.sourceName];
            if (!iconUrl) iconUrl = client.user?.displayAvatarURL({ extension: 'png' });
            const embed = client
                .embed()
                .setAuthor({ name: `Now Playing`, iconURL: iconUrl })
                .setColor(client.color.main)
                .setDescription(
                    `[${player.current.info.title}](${player.current.info.uri
                    }) - \`[${client.utils.formatTime(
                        player.current.info.length
                    )}]\` - Requested by ${player.current.info.requester}`
                )
                .setImage(player.current.info.artworkUrl ?? null);
            const listening = await listeningActive(client, guild.id);
            const components = getButtons().map(b => {
                b.components.forEach(c => {
                    c.setDisabled(player && player.current ? false : true);
                });
                return b;
            });
            await m
                .edit(
                    listening
                        ? { ...withLiveBadge(client, embed), components }
                        : { embeds: [embed], components, attachments: [] }
                )
                .catch(() => { });
        } else {
            const embed = client
                .embed()
                .setColor(client.color.main)
                .setAuthor({
                    name: client.user?.username ?? 'BootstrapDJ',
                    iconURL: client.user?.displayAvatarURL({ extension: 'png' }),
                })
                .setDescription(`Nothing playing right now`)
                .setImage(client.config.links.img);
            const listening = await listeningActive(client, guild.id);
            const components = getButtons().map(b => {
                b.components.forEach(c => {
                    c.setDisabled(true);
                });
                return b;
            });
            await m
                .edit(
                    listening
                        ? { ...withLiveBadge(client, embed), components }
                        : { embeds: [embed], components, attachments: [] }
                )
                .catch(() => { });
        }
    }
}

async function buttonReply(
    int: ButtonInteraction<'cached'> | StringSelectMenuInteraction<'cached'>,
    args: string,
    color: ColorResolvable
): Promise<void> {
    const embed = new EmbedBuilder();
    let m: Message | undefined;
    if (int.replied) {
        const reply = await int
            .editReply({ embeds: [embed.setColor(color).setDescription(args)] })
            .catch(() => null);
        if (reply) m = reply;
    } else {
        const reply = await int
            .followUp({ embeds: [embed.setColor(color).setDescription(args)] })
            .catch(() => null);
        if (reply) m = reply;
    }
    setTimeout(async () => {
        if (int && !int.ephemeral) {
            await m?.delete().catch(() => { });
        }
    }, 2000);
}

async function oops(channel: TextChannel, args: string): Promise<void> {
    try {
        let embed1 = new EmbedBuilder().setColor('Red').setDescription(`${args}`);

        const m = await channel.send({
            embeds: [embed1],
        });

        const timer = setTimeout(
            async () => await m.delete().catch(() => {}),
            12000
        );
        (timer as unknown as { unref?: () => void }).unref?.();
    } catch (e) {
        return console.error(e);
    }
}
const setupJanitors = new Map<string, ReturnType<typeof setInterval>>();

/**
 * Empty the song-request channel and post a fresh "nothing playing" mock.
 * Runs once per boot so the channel never accumulates history across restarts.
 */
export async function resetSetupChannel(
    client: BootstrapClient,
    setup: { guildId: string; textId: string }
): Promise<void> {
    const guild = client.guilds.cache.get(setup.guildId);
    const channel = guild?.channels.cache.get(setup.textId) as TextChannel | undefined;
    if (!guild || !channel) return;

    let removed = 0;
    try {
        // bulkDelete refuses messages older than 14 days and caps at 100 a call.
        for (let pass = 0; pass < 10; pass++) {
            const messages = await channel.messages.fetch({ limit: 100 });
            if (!messages.size) break;
            const recent = messages.filter(
                message => Date.now() - message.createdTimestamp < 14 * 24 * 60 * 60 * 1000
            );
            if (!recent.size) break;
            const deleted = await channel.bulkDelete(recent, true);
            removed += deleted.size;
            if (messages.size < 100) break;
        }
    } catch (error) {
        client.logger.error(`[setup] purge of ${channel.id} failed: ${error}`);
    }

    try {
        const embed = client
            .embed()
            .setColor(client.color.main)
            .setAuthor({
                name: client.user?.username ?? 'BootstrapDJ',
                iconURL: client.user?.displayAvatarURL({ extension: 'png' }),
            })
            .setDescription('Nothing playing right now')
            .setImage(client.config.links.img);
        const components = getButtons().map(row => {
            row.components.forEach(component => component.setDisabled(true));
            return row;
        });
        const listening = await listeningActive(client, guild.id);
        const message = await channel.send(
            listening
                ? { ...withLiveBadge(client, embed), components }
                : { embeds: [embed], components }
        );
        await client.db.setSetup(guild.id, channel.id, message.id);
    } catch (error) {
        client.logger.error(`[setup] could not post a fresh mock in ${channel.id}: ${error}`);
    }

    client.logger.info(`[setup] ${channel.name}: purged ${removed} messages`);
}

/**
 * Periodically delete everything in the song-request channel except the mock
 * player, so the channel stays a control surface instead of a chat log.
 */
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
                    Date.now() - message.createdTimestamp > Math.max(5000, (client.config.deleteAfter || 0) * 1000)
            );
            if (!stale.size) return;
            const recent = stale.filter(
                message => Date.now() - message.createdTimestamp < 14 * 24 * 60 * 60 * 1000
            );
            if (recent.size) await channel.bulkDelete(recent, true).catch(() => {});
            for (const message of stale.filter(m => !recent.has(m.id)).values())
                await message.delete().catch(() => {});
        } catch (error) {
            client.logger.error(`[setup] janitor failed for ${guildId}: ${error}`);
        }
    }, seconds * 1000);
    (timer as unknown as { unref?: () => void }).unref?.();
    setupJanitors.set(guildId, timer);
}

export { setupStart, trackStart, buttonReply, updateSetup, oops };

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
