import {
    APIInteractionGuildMember,
    BaseMessageOptions,
    ChatInputCommandInteraction,
    CommandInteraction,
    DMChannel,
    Guild,
    GuildMember,
    GuildMemberResolvable,
    GuildTextBasedChannel,
    InteractionReplyOptions,
    InteractionResponse,
    Message,
    PartialDMChannel,
    PartialGroupDMChannel,
    TextChannel,
    User,
    VoiceBasedChannel,
} from 'discord.js';

import { BootstrapClient } from './index.js';

type ReplyTarget = 'reply' | 'message';
type OutboundPayload = string | BaseMessageOptions;

/**
 * Normalized wrapper around either a slash interaction or a prefix message.
 *
 * Commands should not branch on Discord's transport. This class keeps the two
 * entry paths behind one reply API while preserving each transport's deletion
 * and ephemeral behavior.
 */
export default class Context {
    public ctx: CommandInteraction | Message;
    public interaction: ChatInputCommandInteraction | null;
    public message: Message | null;
    public id: string;
    public channelId: string;
    public client: BootstrapClient;
    public author: User | null;
    public channel:
        | PartialDMChannel
        | PartialGroupDMChannel
        | GuildTextBasedChannel
        | TextChannel
        | DMChannel
        | null;
    public guild: Guild | null;
    public createdAt: Date;
    public createdTimestamp: number;
    public member: GuildMemberResolvable | GuildMember | APIInteractionGuildMember | null;
    public args: string[] = [];
    public msg: Message | null = null;
    /** Slash feedback is private unless the command or guild opts out. */
    public ephemeral: boolean;
    /** Per-guild auto-delete override in seconds; null falls back to config. */
    public deleteAfter: number | null = null;

    private deleteTimer: NodeJS.Timeout | null = null;

    public constructor(
        ctx: ChatInputCommandInteraction | Message,
        args: readonly unknown[],
        ephemeral: boolean = true
    ) {
        this.ctx = ctx;
        this.interaction = ctx instanceof ChatInputCommandInteraction ? ctx : null;
        this.message = ctx instanceof Message ? ctx : null;
        this.id = ctx.id;
        this.channelId = ctx.channelId;
        this.client = ctx.client as BootstrapClient;
        this.author = ctx instanceof Message ? ctx.author : ctx.user;
        this.channel = ctx.channel;
        this.guild = ctx.guild;
        this.createdAt = ctx.createdAt;
        this.createdTimestamp = ctx.createdTimestamp;
        this.member = ctx.member;
        this.ephemeral = ephemeral;
        this.replaceArgs(args);
    }

    private get slash(): ChatInputCommandInteraction {
        if (!this.interaction) throw new Error('Context is not tied to an interaction');
        return this.interaction;
    }

    private get prefixChannel(): TextChannel {
        if (!this.message) throw new Error('Context is not tied to a message');
        return this.message.channel as TextChannel;
    }

    public get isInteraction(): boolean {
        return this.ctx instanceof ChatInputCommandInteraction;
    }

    public setArgs(args: readonly unknown[]): void {
        this.replaceArgs(args);
    }

    private replaceArgs(args: readonly unknown[]): void {
        this.args = this.isInteraction ? args.map(valueOfInteractionOption) : args.map(String);
    }

    public get voiceChannel(): VoiceBasedChannel | null {
        const member = this.member;
        if (!member || typeof member !== 'object' || !('voice' in member)) return null;
        return member.voice?.channel ?? null;
    }

    /** Acknowledge before slow work so Discord's three-second deadline is met. */
    public async defer(ephemeral: boolean = false): Promise<void> {
        if (!this.isInteraction) return;
        if (this.slash.deferred || this.slash.replied) return;
        await this.slash.deferReply({ ephemeral });
    }

    private async settled(response: Message | InteractionResponse<boolean>): Promise<Message> {
        return response instanceof Message ? response : await this.slash.fetchReply();
    }

    private scopedPayload(content: OutboundPayload): string | InteractionReplyOptions {
        if (!this.isInteraction || !this.ephemeral) return content;
        if (typeof content === 'string') return { content, ephemeral: true };
        return { ...content, ephemeral: true };
    }

    private shouldSkipDeletion(content: OutboundPayload): boolean {
        if (this.isInteraction && this.ephemeral) return true;
        if (typeof content === 'string') return false;
        if (content.components?.length) return true;
        return Boolean((content as InteractionReplyOptions).ephemeral);
    }

    private armDeletion(content: OutboundPayload, target: ReplyTarget, seconds?: number): void {
        if (this.deleteTimer) {
            clearTimeout(this.deleteTimer);
            this.deleteTimer = null;
        }
        const delay = seconds ?? this.deleteAfter ?? this.client.config.deleteAfter;
        if (!delay || delay <= 0 || this.shouldSkipDeletion(content)) return;

        const timer = setTimeout(() => {
            const removal = target === 'reply' ? this.slash.deleteReply() : this.msg?.delete();
            Promise.resolve(removal).catch(() => {});
        }, delay * 1000);
        (timer as unknown as { unref?: () => void }).unref?.();
        this.deleteTimer = timer;
    }

    private async sendPrefix(content: OutboundPayload, seconds?: number): Promise<Message> {
        this.msg = await this.prefixChannel.send(content);
        this.armDeletion(content, 'message', seconds);
        return this.msg;
    }

    public async sendMessage(content: OutboundPayload, deleteAfter?: number): Promise<Message> {
        if (!this.isInteraction) return await this.sendPrefix(content, deleteAfter);

        const response = this.deferred
            ? await this.slash.editReply(content)
            : await this.slash.reply(this.scopedPayload(content));
        this.msg = await this.settled(response);
        this.armDeletion(content, 'reply', deleteAfter);
        return this.msg;
    }

    public async editMessage(content: OutboundPayload): Promise<Message> {
        if (!this.isInteraction) {
            if (!this.msg) throw new Error('No message to edit');
            this.msg = await this.msg.edit(content);
            this.armDeletion(content, 'message');
            return this.msg;
        }

        if (this.msg || this.deferred) {
            this.msg = await this.settled(await this.slash.editReply(content));
            this.armDeletion(content, 'reply');
        }
        if (!this.msg) throw new Error('No interaction message to edit');
        return this.msg;
    }

    public async sendDeferMessage(content: OutboundPayload): Promise<Message> {
        if (!this.isInteraction) return await this.sendPrefix(content);

        await this.slash.deferReply({ ephemeral: this.ephemeral });
        this.msg = await this.slash.fetchReply();
        this.armDeletion(content, 'reply');
        return this.msg;
    }

    public async sendFollowUp(content: OutboundPayload): Promise<void> {
        if (!this.isInteraction) {
            await this.sendPrefix(content);
            return;
        }
        const response = await this.slash.followUp(this.scopedPayload(content));
        this.msg = response instanceof Message ? response : await this.slash.fetchReply();
        this.armDeletion(content, 'message');
    }

    public get deferred(): boolean {
        return this.isInteraction ? this.slash.deferred : Boolean(this.msg);
    }
}

function valueOfInteractionOption(option: unknown): string {
    const value = (option as { value?: unknown }).value;
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value) ?? '';
}
