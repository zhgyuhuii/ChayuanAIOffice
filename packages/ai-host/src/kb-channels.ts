/** Wire contract shared by the KB IPC registration and every preload bridge. */
export const KB_CHANNELS = {
  discover: 'kb:discover',
  list: 'kb:list',
  search: 'kb:search',
  doc: 'kb:doc',
  file: 'kb:file',
  getSource: 'kb:get-source',
  setOrigin: 'kb:set-origin',
} as const
