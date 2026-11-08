import { BootstrapClient, Command, Context } from '../../core/index.js';

const TIPS = [
    'Use `/playnext` to jump a request to the front of the queue.',
    '`/autoplay` keeps related music playing after the queue drains.',
    '`/queue` is public; most other replies are ephemeral to keep the channel clean.',
    'Use `/filters` to see which audio filters are active.',
    '`/recentlyplayed` shows what has already played this session.',
    '`/playrecent 5` requeues the last five tracks.',
    'Use `/sort title asc` or `/sort duration desc` to reorder the queue.',
    '`/removeabsent` clears requests from users who left the voice channel.',
];

export default class Tip extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'tip',
            description: {
                content: 'Shows a random BootstrapDJ tip',
                usage: 'tip',
                examples: ['tip'],
            },
            category: 'info',
            aliases: ['tips'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: {
                dev: false,
                client: ['SendMessages', 'ViewChannel', 'EmbedLinks'],
                user: [],
            },
            slashCommand: false,
            options: [],
        });
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
        return await ctx.sendMessage({
            embeds: [
                client.embed().setColor(client.color.main).setTitle('Tip').setDescription(tip),
            ],
        });
    }
}
