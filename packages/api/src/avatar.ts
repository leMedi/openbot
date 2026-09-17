// Avatar vocabulary shared by the agent profile validators and the web UI.
// Pure data: safe to import from any bundle.

export const AVATAR_COLORS = [
  '#f2f2f2',
  '#b0783a',
  '#b3536e',
  '#c46b4a',
  '#5f9e63',
  '#3f8f8a',
  '#5865c4',
  '#8a5fc4',
  '#9a9aa0',
]

export const AVATAR_SHAPES = [
  { id: 'circle', d: 'M24 4a20 20 0 1 1 0 40a20 20 0 1 1 0-40Z' },
  { id: 'squircle', d: 'M24 5c13 0 19 6 19 19s-6 19-19 19S5 37 5 24 11 5 24 5Z' },
  { id: 'pill', d: 'M14 12h20a12 12 0 0 1 0 24H14a12 12 0 0 1 0-24Z' },
  {
    id: 'triangle',
    d: 'M20.5 8.2c1.6-2.7 5.4-2.7 7 0l14.8 25.6c1.6 2.7-.3 6.2-3.5 6.2H9.2c-3.2 0-5.1-3.5-3.5-6.2Z',
  },
  {
    id: 'hexagon',
    d: 'M21 4.7a6 6 0 0 1 6 0l12.3 7.1a6 6 0 0 1 3 5.2v14a6 6 0 0 1-3 5.2L27 43.3a6 6 0 0 1-6 0L8.7 36.2a6 6 0 0 1-3-5.2v-14a6 6 0 0 1 3-5.2Z',
  },
  {
    id: 'cloud',
    d: 'M13 40a9 9 0 0 1-2-17.8A12.5 12.5 0 0 1 35.3 19 8.5 8.5 0 0 1 35 40Z',
  },
  {
    id: 'drop',
    d: 'M24 4c9 10.4 16 18.6 16 26a16 16 0 0 1-32 0C8 22.6 15 12.4 24 4Z',
  },
]
