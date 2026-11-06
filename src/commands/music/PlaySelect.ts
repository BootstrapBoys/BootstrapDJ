import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { LoadType, Track } from 'shoukaku';

import { BootstrapClient, Command, Context } from '../../structures/index.js';
import { resolveSearchEngine } from '../../utils/SearchEngine.js';

const PAGE_SIZE = 25;

export default class PlaySelect extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'playselect',
            description: {
                content: 'Browse a playlist or search results and choose a track',
                usage: 'playselect <url or search>',
                examples: ['playselect https://www.deezer.com/playlist/…'],
            },
            category: 'music',
            aliases: ['pselect'],
            cooldown: 3,
            args: true,
            defer: true,
            player: { voice: true, dj: false, active: false, djPerm: null },
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
            slashCommand: true,
            options: [
                {
                    name: 'url',
                    description: 'Playlist URL or search term',
                    type: 3,
                    required: true,
                },
            ],
        });
    }

    public async run(client: BootstrapClient, ctx: Context, args: string[]): Promise<unknown> {
        const guild = ctx.guild;
        const author = ctx.author;
        if (!guild || !author) return;
        const query = args.join(' ').trim();
        if (!query) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Provide a playlist URL or search term.')],
            });
        }

        let player = client.queue.get(guild.id);
        if (!player || player.isStale) player = await client.queue.create(guild, ctx.voiceChannel, ctx.channel);

        const res = await client.queue.search(query, await resolveSearchEngine(client, ctx));
        if (!res) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('No results found.')],
            });
        }
        const tracks: Track[] =
            res.loadType === LoadType.PLAYLIST
                ? res.data.tracks
                : res.loadType === LoadType.TRACK
                  ? [res.data]
                  : res.loadType === LoadType.SEARCH
                    ? res.data
                    : [];
        if (!tracks.length) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('No tracks found.')],
            });
        }

        const enqueue = async (track: Track): Promise<void> => {
            const song = player.buildTrack(track, author);
            player.enqueue(song);
            await player.isPlaying();
        };

        if (tracks.length === 1) {
            await enqueue(tracks[0]);
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setDescription(`Queued [${tracks[0].info.title}](${tracks[0].info.uri}).`),
                ],
            });
        }

        const pages = Math.ceil(tracks.length / PAGE_SIZE);
        let page = 0;
        const build = (index: number): Record<string, unknown> => {
            const start = index * PAGE_SIZE;
            const pageTracks = tracks.slice(start, start + PAGE_SIZE);
            const lines = pageTracks
                .map(
                    (track, offset) =>
                        `**${start + offset + 1}.** [${track.info.title}](${track.info.uri}) — ${track.info.author}`
                )
                .join('\n');
            const menu = new StringSelectMenuBuilder()
                .setCustomId('playselect:pick')
                .setPlaceholder(`Choose a track — page ${index + 1} of ${pages}`)
                .addOptions(
                    pageTracks.map((track, offset) => ({
                        label: track.info.title.slice(0, 100),
                        description: track.info.author.slice(0, 100),
                        value: String(start + offset),
                    }))
                );
            const previous = new ButtonBuilder()
                .setCustomId('playselect:previous')
                .setLabel('Previous')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(index === 0);
            const next = new ButtonBuilder()
                .setCustomId('playselect:next')
                .setLabel('Next')
                .setStyle(ButtonStyle.Primary)
                .setDisabled(index >= pages - 1);
            return {
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.main)
                        .setTitle(`Select a track (${tracks.length} results)`)
                        .setDescription(lines),
                ],
                components: [
                    new ActionRowBuilder<ButtonBuilder>().addComponents(previous, next),
                    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
                ],
            };
        };

        const msg = await ctx.sendMessage(build(0));
        const collector = msg.createMessageComponentCollector({
            filter: interaction => interaction.user.id === author.id,
            time: 120_000,
        });

        collector.on('collect', async interaction => {
            if (interaction.isButton()) {
                if (interaction.customId === 'playselect:previous') page = Math.max(0, page - 1);
                else if (interaction.customId === 'playselect:next') page = Math.min(pages - 1, page + 1);
                await interaction.update(build(page));
                return;
            }
            if (!interaction.isStringSelectMenu()) return;
            const selected = Number(interaction.values[0]);
            const track = tracks[selected];
            if (!track) {
                await interaction.reply({ content: 'That track is no longer available.', ephemeral: true });
                return;
            }
            await interaction.deferUpdate();
            await enqueue(track);
            await msg
                .edit({
                    embeds: [
                        client
                            .embed()
                            .setColor(client.color.main)
                            .setDescription(`Queued [${track.info.title}](${track.info.uri}).`),
                    ],
                    components: [],
                })
                .catch(() => {});
            client.utils.scheduleDelete(client, msg);
            collector.stop('picked');
        });

        collector.on('end', async (_collected, reason) => {
            if (reason !== 'picked') await msg.delete().catch(() => {});
        });
    }
}
