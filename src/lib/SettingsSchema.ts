export const AUTOPLAY_FIELDS = new Set(['autoplaysource', 'autoplayseeds', 'autoplayreset']);

export const DEFAULTS: Record<string, string> = {
    defaultvolume: '100',
    defaultautoplay: 'false',
    defaultrepeat: 'off',
    defaultshuffle: 'false',
    searchtype: 'dzsearch',
    maxqueue: '200',
    maxuserqueue: '50',
    voteskip: 'true',
    voteskippercent: '50',
    announce: 'true',
    ephemeral: 'true',
    deleteafter: '10',
    commandchannel: '',
    voicechannel: '',
    announcechannel: '',
    disabledcommands: '',
    autoplaysource: '',
    autoplayseeds: '',
    maxtracklength: '0',
    mintracklength: '0',
    maxusertracks: '0',
    maxusertrackslength: '0',
    maxplaylisttracks: '0',
    maxplaylistlength: '0',
    autocorrect: 'false',
    volumeautomatic: 'false',
    loudnesstarget: '-16',
    locked: 'false',
    allowthreads: 'true',
    dashboardvoicepriority: 'true',
    timeoutlisteners: '5',
    timeoutpause: '0',
    timeoutplaying: '0',
    timeoutconfirmation: '0',
};

export function isKnownSetting(key: string): key is keyof typeof DEFAULTS {
    return Object.prototype.hasOwnProperty.call(DEFAULTS, key) || AUTOPLAY_FIELDS.has(key);
}
