import { ApplicationCommandOptionType } from 'discord.js';
import { LoadType } from 'shoukaku';

import { BootstrapClient, Command, Context } from '../../structures/index.js';

type RadioStation = {
    name?: string;
    url_resolved?: string;
    country?: string;
    tags?: string;
    codec?: string;
    bitrate?: number;
};

export default class Radio extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'radio',
            description: { content: 'Plays an internet radio station by name', usage: 'radio <station>', examples: ['radio lofi', 'radio jazz'] },
            category: 'music',
            aliases: ['radiostation'],
            cooldown: 5,
            args: true,
            defer: true,
            player: { voice: true, dj: false, active: false, djPerm: null },
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
            slashCommand: true,
            options: [
                { name: 'station', description: 'Station name or genre', type: ApplicationCommandOptionType.String, required: true },
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
                embeds: [client.embed().setColor(client.color.red).setDescription('Provide a station name or genre.')],
            });
        }
        const url = new URL('https://de1.api.radio-browser.info/json/stations/search');
        url.searchParams.set('name', query);
        url.searchParams.set('limit', '5');
        url.searchParams.set('hidebroken', 'true');
        url.searchParams.set('order', 'clickcount');
        url.searchParams.set('reverse', 'true');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        let stations: RadioStation[] = [];
        try {
            const response = await fetch(url, { signal: controller.signal });
            if (response.ok) stations = (await response.json()) as RadioStation[];
        } catch (error) {
            client.logger.warn(`[radio] station lookup failed: ${error}`);
        } finally {
            clearTimeout(timer);
        }
        const station = stations.find(item => item.url_resolved?.startsWith('http'));
        if (!station?.url_resolved) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription(`No working radio station found for **${query}**.`)],
            });
        }
        let player = client.queue.get(guild.id);
        if (!player || player.isStale) player = await client.queue.create(guild, ctx.voiceChannel, ctx.channel);
        const res = await client.queue.search(station.url_resolved);
        if (!res || res.loadType !== LoadType.TRACK) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('The station stream could not be loaded.')],
            });
        }
        const song = player.buildTrack(res.data, author);
        player.enqueue(song);
        await player.isPlaying();
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(
                        `Playing **${station.name ?? query}**${station.country ? ` (${station.country})` : ''} — ${station.codec ?? 'stream'}${station.bitrate ? ` ${station.bitrate}kbps` : ''}.`
                    ),
            ],
        });
    }
}
