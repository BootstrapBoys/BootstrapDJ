import { ApplicationCommandOptionType } from 'discord.js';

import { BootstrapClient, Command, Context } from '../../core/index.js';

const HEX = /^#?[0-9a-f]{6}$/i;

export default class Profile extends Command {
    constructor(client: BootstrapClient) {
        super(client, {
            name: 'profile',
            description: { content: 'View or customize a BootstrapDJ profile', usage: 'profile [view|set|clear] [key] [value]', examples: ['profile', 'profile set color #ff8800', 'profile set bio Music first'] },
            category: 'info',
            aliases: ['profiles'],
            cooldown: 3,
            args: false,
            player: { voice: false, dj: false, active: false, djPerm: null },
            permissions: { dev: false, client: ['SendMessages', 'ViewChannel', 'EmbedLinks'], user: [] },
            slashCommand: true,
            options: [
                {
                    name: 'action',
                    description: 'View, set, or clear profile fields',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                    choices: [
                        { name: 'view', value: 'view' },
                        { name: 'set', value: 'set' },
                        { name: 'clear', value: 'clear' },
                    ],
                },
                {
                    name: 'key',
                    description: 'Field to change: color, bio, privacy, visible',
                    type: ApplicationCommandOptionType.String,
                    required: false,
                    choices: [
                        { name: 'color', value: 'color' },
                        { name: 'bio', value: 'bio' },
                        { name: 'privacy', value: 'privacy' },
                        { name: 'visible', value: 'visible' },
                        { name: 'background', value: 'background' },
                        { name: 'avatarshape', value: 'avatarshape' },
                        { name: 'avatarborder', value: 'avatarborder' },
                        { name: 'servervisible', value: 'servervisible' },
                    ],
                },
                { name: 'value', description: 'New value', type: ApplicationCommandOptionType.String, required: false },
                { name: 'user', description: 'Profile to view', type: ApplicationCommandOptionType.User, required: false },
            ],
        });
    }

    private option(ctx: Context, name: string, index: number): string | null {
        if (ctx.isInteraction && ctx.interaction) return ctx.interaction.options.getString(name) ?? null;
        return ctx.args[index] ?? null;
    }

    public async run(client: BootstrapClient, ctx: Context): Promise<unknown> {
        const author = ctx.author;
        if (!author) return;
        const action = (this.option(ctx, 'action', 0) ?? 'view').toLowerCase();
        const key = (this.option(ctx, 'key', 1) ?? '').toLowerCase();
        const value = (this.option(ctx, 'value', 2) ?? '').trim();

        if (action === 'view') {
            const target =
                (ctx.isInteraction && ctx.interaction?.options.getUser('user')) ||
                ctx.message?.mentions.users.first() ||
                author;
            const profile = await client.db.getProfile(target.id);
            if (target.id !== author.id && (!profile || profile.privacy === 'private' || !profile.visible)) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('That profile is private.')],
                });
            }
            const color = profile?.color && HEX.test(profile.color) ? profile.color.replace(/^#/, '') : null;
            const embed = client
                .embed()
                .setColor(color ? `#${color}` : client.color.main)
                .setAuthor({ name: target.username, iconURL: target.displayAvatarURL() })
                .setDescription(profile?.bio || 'No bio set.')
                .addFields(
                    { name: 'Visibility', value: profile?.visible === false ? 'hidden' : 'visible', inline: true },
                    { name: 'Privacy', value: profile?.privacy ?? 'public', inline: true },
                    { name: 'Server visible', value: profile?.serverVisible === false ? 'no' : 'yes', inline: true },
                    { name: 'Avatar shape', value: profile?.avatarShape ?? 'circle', inline: true }
                );
            return await ctx.sendMessage({ embeds: [embed] });
        }

        if (action === 'clear') {
            await client.db.setProfile(author.id, {
                color: null,
                bio: null,
                background: null,
                avatarShape: null,
                avatarBorder: null,
                privacy: 'public',
                visible: true,
                serverVisible: true,
            });
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.green).setDescription('Profile reset.')],
            });
        }

        if (!key) {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Choose color, bio, privacy, or visible.')],
            });
        }
        if (key === 'color') {
            if (!HEX.test(value)) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('Use a hex color such as `#ff8800`.')],
                });
            }
            await client.db.setProfile(author.id, { color: value.startsWith('#') ? value : `#${value}` });
        } else if (key === 'bio') {
            if (value.length > 200) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('Bios are limited to 200 characters.')],
                });
            }
            await client.db.setProfile(author.id, { bio: value || null });
        } else if (key === 'privacy') {
            if (!['public', 'private'].includes(value)) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('Privacy must be `public` or `private`.')],
                });
            }
            await client.db.setProfile(author.id, { privacy: value });
        } else if (key === 'visible') {
            const visible = ['true', 'yes', 'on', '1'].includes(value.toLowerCase());
            await client.db.setProfile(author.id, { visible });
        } else if (key === 'servervisible') {
            const serverVisible = ['true', 'yes', 'on', '1'].includes(value.toLowerCase());
            await client.db.setProfile(author.id, { serverVisible });
        } else if (key === 'background') {
            if (value.length > 200) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('Backgrounds are limited to 200 characters.')],
                });
            }
            await client.db.setProfile(author.id, { background: value || null });
        } else if (key === 'avatarshape') {
            if (!['circle', 'square', 'rounded'].includes(value.toLowerCase())) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('Avatar shape must be `circle`, `square`, or `rounded`.')],
                });
            }
            await client.db.setProfile(author.id, { avatarShape: value.toLowerCase() });
        } else if (key === 'avatarborder') {
            if (value.length > 50) {
                return await ctx.sendMessage({
                    embeds: [client.embed().setColor(client.color.red).setDescription('Avatar borders are limited to 50 characters.')],
                });
            }
            await client.db.setProfile(author.id, { avatarBorder: value || null });
        } else {
            return await ctx.sendMessage({
                embeds: [client.embed().setColor(client.color.red).setDescription('Unknown profile field.')],
            });
        }
        return await ctx.sendMessage({
            embeds: [client.embed().setColor(client.color.green).setDescription(`Updated profile **${key}**.`)],
        });
    }
}
