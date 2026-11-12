/**
 * Test fixtures reproducing the real TXT export format of the crawler.
 */

/**
 * A complete and valid movie payload.
 */
export const VALID_MOVIE_JSON = {
  id: 'ophim-abc123',
  name: 'Bác Sĩ X',
  slug: 'bac-si-x',
  originName: 'Doctor X',
  content: 'Nội dung tóm tắt của bộ phim Bác Sĩ X.',
  actors: [{ name: 'Nguyễn Văn A' }, { name: 'Trần Thị B' }],
  info: {
    directors: ['Đạo diễn C'],
    year: 2023,
    status: 'completed',
    time: '45 phút/tập',
    episodeCurrent: 10,
    episodeTotal: 12,
    quality: 'HD',
    view: 1500,
    thumbUrl: 'https://img.example.com/bac-si-x-thumb.jpg',
    posterUrl: 'https://img.example.com/bac-si-x-poster.jpg',
    categories: [{ name: 'Hành động', slug: 'hanh-dong' }],
    countries: [{ name: 'Hàn Quốc', slug: 'han-quoc' }],
    languages: 'Vietsub',
    tmdb: { type: 'tv', id: '12345', season: 1 },
  },
  sources: [
    {
      server_name: 'Vietsub #1',
      server_data: [
        {
          name: '1',
          slug: 'tap-1',
          filename: 'tap-1',
          link_embed: 'https://example.com/embed/episode-1',
          link_m3u8: '',
        },
        {
          name: '2',
          slug: 'tap-2',
          filename: 'tap-2',
          link_embed: 'https://example.com/embed/episode-2',
          link_m3u8: 'https://example.com/stream/episode-2.m3u8',
        },
      ],
    },
    {
      server_name: 'Vietsub #2',
      server_data: [
        {
          name: '1',
          slug: 'tap-1',
          filename: 'tap-1',
          link_embed: 'https://example.com/embed/episode-1-server2',
          link_m3u8: '',
        },
      ],
    },
  ],
};

/**
 * A payload with the minimum required information.
 */
export const MINIMAL_MOVIE_JSON = {
  id: 'minimal-1',
  name: 'Phim Tối Giản',
  slug: 'phim-toi-gian',
  info: { year: 2020 },
  sources: [],
};

/**
 * A payload without a name, which makes the file invalid.
 */
export const MISSING_NAME_JSON = {
  id: 'no-name-1',
  slug: 'khong-co-ten',
  info: { year: 2021 },
};

/**
 * A payload with Vietnamese characters and unicode content.
 */
export const UNICODE_MOVIE_JSON = {
  id: 'unicode-1',
  name: 'Đảo Chính: Đặc Sắc 🎬',
  slug: 'dao-chinh-dac-sac',
  content: 'Nội dung tiếng Việt có dấu: Đ, Ộ, ễ, ằ...',
  actors: [{ name: 'Nguyễn Hoàng Ái' }],
  info: {
    year: 2024,
    languages: 'Vietsub',
    categories: ['Hài'],
  },
};

/**
 * A payload with a YouTube trailer.
 */
export const MOVIE_WITH_TRAILER_JSON = {
  id: 'trailer-1',
  name: 'Phim Có Trailer',
  slug: 'phim-co-trailer',
  info: {
    year: 2022,
    trailerUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  },
  sources: [],
};

/**
 * A payload with a trailer key but no URL.
 */
export const MOVIE_WITH_TRAILER_KEY_JSON = {
  id: 'trailer-2',
  name: 'Phim Có Trailer Key',
  slug: 'phim-co-trailer-key',
  trailer: { key: 'abc123XYZ_-' },
  info: { year: 2022 },
  sources: [],
};

/**
 * A payload without any trailer information.
 */
export const MOVIE_WITHOUT_TRAILER_JSON = {
  id: 'no-trailer-1',
  name: 'Phim Không Trailer',
  slug: 'phim-khong-trailer',
  info: { year: 2022 },
  sources: [],
};

/**
 * A payload with duplicated episodes inside the same server.
 */
export const MOVIE_WITH_DUPLICATE_EPISODES_JSON = {
  id: 'dup-1',
  name: 'Phim Tập Trùng',
  slug: 'phim-tap-trung',
  info: { year: 2023 },
  sources: [
    {
      server_name: 'Vietsub #1',
      server_data: [
        { name: '1', slug: 'tap-1', filename: 'tap-1', link_embed: 'https://a/1' },
        { name: '1', slug: 'tap-1', filename: 'tap-1', link_embed: 'https://a/1-duplicate' },
        { name: '2', slug: 'tap-2', filename: 'tap-2', link_embed: 'https://a/2' },
      ],
    },
  ],
};

/**
 * Builds the raw text content of a TXT file.
 *
 * @param payload - The payload to serialize.
 * @returns The text content of the file.
 */
export function buildTxtContent(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}
