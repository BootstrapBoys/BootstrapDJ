import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

export default class Guess extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'guess',
            description: {
                content: 'Starts a guess-the-song game for the current track',
                usage: 'guess',
                examples: ['guess'],
            },
            category: 'games',
            aliases: ['guessthesong'],
            cooldown: 5,
            args: false,
            ephemeral: false,
            player: { voice: true, dj: false, active: true, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: true,
            options: [],
        });
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const guild = ctx.guild;
        if (!guild) return;
        const player = client.queue.get(guild.id);
        if (!player?.current) {
            return await ctx.sendMessage({
                embeds: [
                    client
                        .embed()
                        .setColor(client.color.red)
                        .setDescription('Nothing is playing right now.'),
                ],
            });
        }
        const titles = [
            player.current.info.title,
            ...player.history
                .slice(-8)
                .reverse()
                .map(track => track.info.title),
            ...player.queue.slice(0, 8).map(track => track.info.title),
        ].filter((title, index, all) => all.indexOf(title) === index);
        while (titles.length < 4) titles.push(`Unknown track ${titles.length + 1}`);
        const choices = titles.slice(0, 4).sort(() => Math.random() - 0.5);
        const correct = player.current.info.title;
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
            choices.map((title, index) =>
                new ButtonBuilder()
                    .setCustomId(`guess-${index}`)
                    .setLabel(title.slice(0, 80))
                    .setStyle(ButtonStyle.Secondary)
            )
        );
        void client.db.recordGameSession(guild.id).catch(() => {});
        const message = await ctx.sendMessage({
            embeds: [
                client
                    .embed()
                    .setColor(client.color.main)
                    .setTitle('Guess the song')
                    .setDescription('Which track is playing? You have 30 seconds.'),
            ],
            components: [row],
        });
        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 30_000,
        });
        collector.on('collect', async interaction => {
            const index = Number(interaction.customId.split('-')[1]);
            const answer = choices[index];
            if (interaction.guildId) {
                await client.db
                    .incrementGameScore(
                        interaction.guildId,
                        interaction.user.id,
                        answer === correct
                    )
                    .catch(() => null);
            }
            await interaction.reply({
                content:
                    answer === correct
                        ? `Correct — **${correct}**!`
                        : `Not quite. The answer was **${correct}**.`,
                ephemeral: true,
            });
            if (answer === correct) collector.stop('correct');
        });
        collector.on('end', async () => {
            await message.edit({ components: [] }).catch(() => null);
        });
        return message;
    }
}
