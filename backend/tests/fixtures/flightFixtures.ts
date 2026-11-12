/**
 * Test fixtures reproducing a React Flight / Next.js Server Component payload
 * with the `movieData` object of the main movie.
 */

/**
 * Builds a minimal React Flight row holding a `movieData` object.
 *
 * @param movieData - The movie data to embed.
 * @param rowId - Identifier of the Flight row.
 * @returns The Flight payload.
 */
export function buildFlightPayload(
  movieData: unknown,
  rowId = '25',
): string {
  return [
    '5:"/_next/static/chunks/03saipjhjn85j.js"',
    '17:"$Sreact.fragment"',
    '14:X',
    '15:[["children",{"s":"__PAGE__","d":{"r":"$L16","p":false,"v":null}}]]',
    `${rowId}:["$","div",null,{"className":"relative","children":[["$","$L36",null,${JSON.stringify(
      { movieData },
    )}]]}]`,
    '38:["$","div",null,{"className":"w-full","children":[]}]',
    '',
  ].join('\n');
}

/**
 * The `movieData` object of the real `doctorX(1).txt` fixture, with the
 * structure of the crawler payload.
 */
export const DOCTORX_MOVIE_DATA = {
  notify: null,
  showtimes: null,
  actors:
    'Kim Ji-won, Lee Jung-eun, Son Hyun-joo, Kim Woo-seok, Lee Jin-hee, Kim Young-min, Lee Sung-wook, Kwon Seung-woo, Heo Joon-seok, Kim Young-ah, Choi Deok-moon, Kim Jung-young, Choi Gwang-il, Jeong Seok-yong, Choi Yeon-hwa',
  directors: 'Đang cập nhật',
  sources: [
    {
      id: '02972500-abbc-4e85-b248-9f98d20eae86',
      serverName: 'KKPhim',
      serverKey: 'kkphim',
      languages: [
        {
          id: 'lang-kk-vietsub',
          name: 'Vietsub',
          slug: 'vietsub',
          episodes: [
            {
              id: 'ep-kk-1',
              name: 'Tập 1',
              slug: 'tap-1',
              episodeNumber: 1,
              displayOrder: 0,
              linkEmbed: 'https://player.phimapi.com/player/?url=https://a.kvp726.com/1/index.m3u8',
              linkM3u8: 'https://a.kvp726.com/1/index.m3u8',
              linkDirect: null,
            },
            {
              id: 'ep-kk-2',
              name: 'Tập 2',
              slug: 'tap-2',
              episodeNumber: 2,
              displayOrder: 1,
              linkEmbed: 'https://player.phimapi.com/player/?url=https://a.kvp726.com/2/index.m3u8',
              linkM3u8: 'https://a.kvp726.com/2/index.m3u8',
              linkDirect: null,
            },
          ],
        },
      ],
    },
    {
      id: '02972500-abbc-4e85-b248-9f98d20eae87',
      serverName: 'NguonC',
      serverKey: 'nguonc',
      languages: [
        {
          id: 'lang-ng-vietsub',
          name: 'Vietsub #1',
          slug: 'vietsub-1',
          episodes: [
            {
              id: 'ep-ng-1',
              name: 'Tập 1',
              slug: 'tap-1',
              episodeNumber: 1,
              displayOrder: 0,
              linkEmbed: 'https://embed12.streamc.xyz/embed.php?hash=abc',
              linkM3u8: null,
              linkDirect: null,
            },
          ],
        },
        {
          id: 'lang-ng-tm',
          name: 'Thuyết minh #1',
          slug: 'thuyet-minh-1',
          episodes: [
            {
              id: 'ep-ng-tm-1',
              name: 'Tập 1',
              slug: 'tap-1',
              episodeNumber: 1,
              displayOrder: 0,
              linkEmbed: 'https://embed11.streamc.xyz/embed.php?hash=def',
              linkM3u8: null,
              linkDirect: null,
            },
          ],
        },
      ],
    },
  ],
  id: 'f0198b76-a449-49c6-8e24-084ec541657d',
  name: 'Bác Sĩ X',
  slug: 'bac-si-x',
  originName: 'Doctor X: Mafia in White',
  content: '<p>Nội dung tóm tắt của bộ phim Bác Sĩ X.</p>',
  typeListId: '9b3c078b-f704-4f9b-bbf0-ca6427ab73e8',
  typeList: [{ id: '9b3c078b-f704-4f9b-bbf0-ca6427ab73e8', name: 'Phim Bộ', slug: 'phim-bo' }],
  status: 'ongoing',
  year: 2026,
  thumbUrl: 'https://phimimg.com/uploads/movies/20261010/bac-si-x-thumb.webp',
  posterUrl: 'https://phimimg.com/uploads/movies/20261010/bac-si-x-poster.webp',
  thumbUrlNguonc: 'https://img.nguonc.com/images/thumb.webp',
  posterUrlNguonc: 'https://img.nguonc.com/images/poster.webp',
  logoNameUrl: null,
  logoNameId: null,
  previewUrl: null,
  previewId: null,
  isChieuRap: false,
  time: '66 phút/tập',
  episodeCurrent: 'Tập 10',
  episodeTotal: '12',
  quality: 'FHD',
  view: 79040,
  trailerUrl: 'https://www.youtube.com/watch?v=v6KNnhkLnnY',
  categories: [
    { id: 'c9823b15', name: 'Bí Ẩn', slug: 'bi-an', isActive: true },
    { id: '54aea095', name: 'Chính Kịch', slug: 'chinh-kich', isActive: true },
  ],
  countries: [
    {
      id: 'a2b810c4',
      name: 'Hàn Quốc',
      slug: 'han-quoc',
      flagUrl: '/images/flag.jpg',
      isActive: true,
    },
  ],
  languages: [
    { id: '7202167f', name: 'Vietsub', slug: 'vietsub', key: 'vs' },
    { id: '8dfbd175', name: 'Song Ngữ', slug: 'song-ngu', key: 'sn' },
  ],
  tmdb: {
    id: '034ebce8-b996-4261-8411-14236fcb9df3',
    tmdbId: '293610',
    type: 'tv',
    season: 1,
    voteAverage: 9,
    voteCount: 2,
  },
};

/**
 * The standalone TMDB payload of the real `doctorX(1).txt` fixture.
 */
export const DOCTORX_STANDALONE_TMDB = {
  cast: [
    {
      adult: false,
      gender: 1,
      id: 582130,
      known_for_department: 'Acting',
      name: 'Kim Ji-won',
      original_name: '김지원',
      popularity: 4.154,
      profile_path: '/lX7W1j9kg4jV6XNn5XEE3rKsd3x.jpg',
      character: 'Gye Su-jeong',
      credit_id: '684929251d6c4a474ebb3ba3',
      order: 0,
    },
    {
      adult: false,
      gender: 1,
      id: 1572354,
      known_for_department: 'Acting',
      name: 'Lee Jung-eun',
      original_name: '이정은',
      popularity: 2.2765,
      profile_path: '/4r3K47UpSmzZ5t9cyTRRqRl9rdz.jpg',
      character: 'Jeong Hee-sook',
      credit_id: '6849293ad88b3daaff9f592f',
      order: 1,
    },
  ],
  backdrops: [
    {
      aspect_ratio: 1.7777778,
      height: 1080,
      iso_3166_1: 'US',
      iso_639_1: 'en',
      file_path: '/backdrop.jpg',
      vote_average: 5.5,
      vote_count: 1,
      width: 1920,
    },
  ],
  similar: [
    {
      id: 'other-movie-id',
      name: 'Phim Đề Xuất',
      slug: 'phim-de-xuat',
      originName: 'Recommended Movie',
    },
  ],
};

/**
 * Builds a Flight payload holding the main movie and the standalone TMDB
 * object, exactly like the real `doctorX(1).txt` file.
 *
 * @param movieData - The movie data to embed.
 * @returns The Flight payload.
 */
export function buildFullFlightPayload(movieData: unknown = DOCTORX_MOVIE_DATA): string {
  const rows = [
    '5:"/_next/static/chunks/03saipjhjn85j.js"',
    '17:"$Sreact.fragment"',
    '14:X',
    '15:[["children",{"s":"__PAGE__","d":{"r":"$L16","p":false,"v":null}}]]',
    `25:["$","div",null,{"className":"relative","children":[["$","$L36",null,${JSON.stringify(
      { movieData },
    )}]]}]`,
    `26:["$","div",null,{"tmdb":${JSON.stringify(
      DOCTORX_STANDALONE_TMDB,
    )},"children":[["$","$L3b",null,{"movieData":"$25:props:children:1:props:children:0:props:children:0:props:children:props:movieData"}]]}]`,
    '38:["$","div",null,{"className":"w-full","children":[]}]',
    '',
  ];

  return rows.join('\n');
}
