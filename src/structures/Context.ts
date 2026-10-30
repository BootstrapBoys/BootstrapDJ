import {
    APIInteractionGuildMember,
    ChatInputCommandInteraction,
    CommandInteraction,
    DMChannel,
    Guild,
    GuildMember,
    GuildMemberResolvable,
    GuildTextBasedChannel,
    Message,
    PartialDMChannel,
    PartialGroupDMChannel,
    TextChannel,
    User,
} from 'discord.js';

import { Lavamusic } from './index.js';

export default class Context {
    public ctx: CommandInteraction | Message;
    public interaction: ChatInputCommandInteraction | null;
    public message: Message | null;
    public id: string;
    public channelId: string;
    public client: Lavamusic;
    public author: User | null;
    public channel:
        | PartialDMChannel
        | PartialGroupDMChannel
        | GuildTextBasedChannel
        | TextChannel
        | DMChannel
        | null = null;
    public guild: Guild | null;
    public createdAt: Date;
    public createdTimestamp: number;
    public member: GuildMemberResolvable | GuildMember | APIInteractionGuildMember | null;
    public args: any[];
    public msg: any;
    constructor(ctx: ChatInputCommandInteraction | Message, args: any[]) {
        this.ctx = ctx;
        this.interaction = this.ctx instanceof ChatInputCommandInteraction ? this.ctx : null;
        this.message = this.ctx instanceof Message ? this.ctx : null;
        this.channel = this.ctx.channel;
        this.id = ctx.id;
        this.channelId = ctx.channelId;
        this.client = ctx.client as Lavamusic;
        this.author = ctx instanceof Message ? ctx.author : ctx.user;
        this.channel = ctx.channel;
        this.guild = ctx.guild;
        this.createdAt = ctx.createdAt;
        this.createdTimestamp = ctx.createdTimestamp;
        this.member = ctx.member;
        this.setArgs(args);
    }

    public get isInteraction(): boolean {
        return this.ctx instanceof ChatInputCommandInteraction;
    }

    public setArgs(args: any[]): void {
        if (this.isInteraction) {
            this.args = args.map((arg: { value: any }) => arg.value);
        } else {
            this.args = args;
        }
    }
    public async sendMessage(content: any, deleteAfter?: number): Promise<Message> {
        const timeout = deleteAfter ?? this.client.config.deleteAfter;
        if (this.isInteraction) {
            this.msg = this.interaction.reply(content);
            this.scheduleDelete(content, timeout);
            return this.msg;
        } else {
            this.msg = await (this.message.channel as TextChannel).send(content);
            this.scheduleDelete(content, timeout);
            return this.msg;
        }
    }

    /**
     * Delete a reply after `seconds` so command output doesn't linger.
     * Messages carrying components are left alone: those are pickers and
     * paginators that must outlive the reply.
     */
    private scheduleDelete(content: any, seconds: number): void {
        if (!seconds || seconds <= 0) return;
        if (content?.components?.length) return;
        if (content?.ephemeral) return;
        const timer = setTimeout(() => {
            const removal = this.isInteraction
                ? this.interaction.deleteReply()
                : Promise.resolve(this.msg).then((msg: Message) => msg?.delete?.());
            Promise.resolve(removal).catch(() => {});
        }, seconds * 1000);
        (timer as unknown as { unref?: () => void }).unref?.();
    }
    public async editMessage(content: any): Promise<Message> {
        if (this.isInteraction) {
            if (this.msg) this.msg = await this.interaction.editReply(content);
            return this.msg;
        } else {
            if (this.msg) this.msg = await this.msg.edit(content);
            return this.msg;
        }
    }
    public async sendDeferMessage(content: any): Promise<Message> {
        if (this.isInteraction) {
            this.msg = await this.interaction.deferReply({ fetchReply: true });
            return this.msg;
        } else {
            this.msg = await (this.message.channel as TextChannel).send(content);
            return this.msg;
        }
    }
    public async sendFollowUp(content: any): Promise<void> {
        if (this.isInteraction) {
            await this.interaction.followUp(content);
        } else {
            this.msg = await (this.message.channel as TextChannel).send(content);
        }
    }
    public get deferred(): boolean | Promise<any> {
        if (this.isInteraction) {
            return this.interaction.deferred;
        }

        if (this.msg) return true;

        return false;
    }
}

/**
 * Project: BootstrapDJ
 * Author: Zebz213
 * Company: BootstrapBoys
 */
