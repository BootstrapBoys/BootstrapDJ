import Dispatcher, { Song } from '../dist/structures/Dispatcher.js';

export const fakeUser = { id: '1', tag: 'tester#0001' };

export function makeSong(
    title,
    { uri, encoded = title, author = 'A', sourceName = 'deezer', identifier = title, autoplay = false } = {}
) {
    return new Song(
        {
            encoded,
            info: {
                identifier,
                isSeekable: true,
                author,
                length: 1000,
                isStream: false,
                position: 0,
                title,
                uri,
                sourceName,
            },
        },
        fakeUser,
        autoplay
    );
}

/** Dispatcher without a Lavalink player: only the queue/selection logic runs. */
export function makeDispatcher(overrides = {}) {
    const dispatcher = Object.create(Dispatcher.prototype);
    Object.assign(
        dispatcher,
        {
            client: {
                user: fakeUser,
                config: {
                    searchEngine: 'ytmsearch',
                    autoplaySeed: 'top hits',
                    autoplayChart: false,
                    autoplaySeeds: [],
                },
                logger: { error: () => {}, info: () => {}, warn: () => {} },
            },
            player: { paused: false },
            queue: [],
            history: [],
            autoplay: false,
            current: null,
            seed: null,
            seeds: [],
            toppingUp: false,
            guildId: 'test-guild',
        },
        overrides
    );
    dispatcher.isPlaying = async () => {};
    return dispatcher;
}

export function view(dispatcher) {
    return dispatcher.queue
        .map(track => `${track.info.title}${track.autoplay ? '(auto)' : ''}`)
        .join(', ');
}
