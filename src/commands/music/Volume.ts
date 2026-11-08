import { ApplicationCommandOptionType } from 'discord.js';

import { defineMusicCommand } from '../../lib/musicCommand.js';

export default defineMusicCommand({
    name: 'volume',
    description: { content: 'Sets the volume of the player', examples: ['volume 100'], usage: 'volume <number>' },
    aliases: ['vol'],
    args: true,
    options: [
        {
            name: 'number',
            description: 'The volume you want to set',
            type: ApplicationCommandOptionType.Integer,
            required: true,
        },
    ],
    run: async ({ client, ctx, player, args }) => {
        if (!player) return;
        const volume = Number(args[0]);
        if (!Number.isFinite(volume)) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Please provide a valid number.')],
            });
        }
        if (volume < 0) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('The volume can\'t be lower than 0.')],
            });
        }
        if (volume > 200) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('The volume can\'t be higher than 200.')],
            });
        }
        await player.player.setGlobalVolume(volume);
        return await ctx.sendMessage({
            embeds: [client.embed().setColor(client.color.main).setDescription(`Set the volume to ${volume}`)],
        });
    },
});
