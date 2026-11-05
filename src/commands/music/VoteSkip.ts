import { ChannelType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../structures/index.js';

type Vote = { key: string; voters: Set<string> };

const votes = new Map<string, Vote>();

export default class VoteSkip extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'voteskip',
            description: { content: 'Starts or joins a vote to skip the current track', usage: 'voteskip', examples: ['voteskip'] },
            category: 'music',
            aliases: ['vskip'],
            cooldown: 3,
            args: false,
            player: { voice: true, dj: false, active: true, djPerm: null },
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
            slashCommand: true,
            options: [],
        });
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const guild = ctx.guild;
        const author = ctx.author;
        if (!guild || !author) return;
        const player = client.queue.get(guild.id);
        if (!player?.current) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Nothing is playing right now.')],
            });
        }
        const channel = player.voiceId ? guild.channels.cache.get(player.voiceId) : null;
        if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('I am not in a voice channel.')],
            });
        }
        const listeners = channel.members.filter(member => !member.user.bot).size;
        const needed = Math.max(1, Math.ceil(listeners / 2));
        const key = player.current.info.uri ?? player.current.encoded;
        let vote = votes.get(guild.id);
        if (!vote || vote.key !== key) {
            vote = { key, voters: new Set() };
            votes.set(guild.id, vote);
        }
        vote.voters.add(author.id);
        if (vote.voters.size >= needed) {
            votes.delete(guild.id);
            await player.skip();
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.main).setDescription('Vote passed — skipping the track.')],
            });
        }
        return await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setDescription(`Vote to skip: **${vote.voters.size}/${needed}**.`),
            ],
        });
    }
}
