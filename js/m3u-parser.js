/**
 * OTT Navigator for LG webOS - M3U Parser & Playlist Engine
 */

const DEFAULT_CHANNELS = [
  {
    id: 'ch-1',
    num: 1,
    name: 'NASA TV HD',
    logo: 'https://images.nasa.gov/images/nasa_logo.svg',
    group: 'Documentary & Science',
    url: 'https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8',
    epgNow: 'Space Station Live Expedition Updates',
    epgNext: 'Earth Views & Deep Space Imagery',
    progress: 45
  },
  {
    id: 'ch-2',
    num: 2,
    name: 'Bloomberg TV+',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/5/5e/Bloomberg_Television_logo.svg',
    group: 'News & Finance',
    url: 'https://liveproduseast.akamaized.net/us/Channel-HD-AWS-virginia-1/master.m3u8',
    epgNow: 'Bloomberg Markets: Global Open',
    epgNext: 'Balance of Power & Wall Street Week',
    progress: 70
  },
  {
    id: 'ch-3',
    num: 3,
    name: 'Red Bull TV',
    logo: 'https://upload.wikimedia.org/wikipedia/en/f/f5/Red_Bull_TV_logo.svg',
    group: 'Sports & Action',
    url: 'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8',
    epgNow: 'Red Bull Rampage: Extreme Mountain Biking',
    epgNext: 'Cliff Diving World Series 2026',
    progress: 25
  },
  {
    id: 'ch-4',
    num: 4,
    name: 'DW News English',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/7/75/Deutsche_Welle_symbol_2012.svg',
    group: 'News & Finance',
    url: 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8',
    epgNow: 'DW News: Global Headlines & Analysis',
    epgNext: 'The Day: Conflict and Diplomacy',
    progress: 60
  },
  {
    id: 'ch-5',
    num: 5,
    name: 'France 24 English',
    logo: 'https://upload.wikimedia.org/wikipedia/en/6/65/France_24_logo.svg',
    group: 'News & Finance',
    url: 'https://static.france24.com/live/F24_EN_LO_HLS/live_tv.m3u8',
    epgNow: 'International News Bulletins',
    epgNext: 'Eye on Africa & The Debate',
    progress: 40
  },
  {
    id: 'ch-6',
    num: 6,
    name: 'Al Jazeera English',
    logo: 'https://upload.wikimedia.org/wikipedia/en/f/f2/Al_Jazeera_English_logo.svg',
    group: 'News & Finance',
    url: 'https://live-hls-web-aje.getaj.net/AJE/03.m3u8',
    epgNow: 'News Hour: In-Depth Coverage',
    epgNext: 'Counting the Cost & Inside Story',
    progress: 85
  },
  {
    id: 'ch-7',
    num: 7,
    name: 'Euronews HD',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/c/cb/Euronews_2016_logo.svg',
    group: 'News & Finance',
    url: 'https://euronews-euronews-world-1-us.samsung.wurl.tv/playlist.m3u8',
    epgNow: 'Good Morning Europe',
    epgNext: 'State of the Union & Global Conversations',
    progress: 30
  },
  {
    id: 'ch-8',
    num: 8,
    name: 'Big Buck Bunny 4K (Demo)',
    logo: 'https://upload.wikimedia.org/wikipedia/commons/c/c5/Big_buck_bunny_poster_big.jpg',
    group: 'Movies & VOD',
    url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8',
    epgNow: 'Open Source 4K HDR Feature Film',
    epgNext: 'Short Film Showcase',
    progress: 15
  },
  {
    id: 'ch-9',
    num: 9,
    name: 'Tears of Steel (Sci-Fi Demo)',
    logo: 'https://mango.blender.org/wp-content/themes/mango/images/logo.png',
    group: 'Movies & VOD',
    url: 'https://content.jwplatform.com/manifests/vM7nH0Kl.m3u8',
    epgNow: 'Tears of Steel: VFX Sci-Fi Odyssey',
    epgNext: 'Behind the Scenes & VFX Breakdown',
    progress: 55
  },
  {
    id: 'ch-10',
    num: 10,
    name: 'Fancode',
    logo: 'https://m.media-amazon.com/images/G/01/LCXO_Station_Logos/FanCode1_White-Logo._AC_SL360_FMpng_.png',
    group: 'Live Sports Events',
    url: 'https://mix.drmlive.net/mix/fancode-1.m3u8?category=cricket',
    manifestType: 'hls',
    drmKey: null,
    drmType: null,
    referrer: 'https://fancode.com/',
    epgNow: 'Live Cricket & Sports Coverage',
    epgNext: 'Match Highlights & Post Analysis',
    progress: 45
  },
  {
    id: 'ch-11',
    num: 11,
    name: 'Fancode 2',
    logo: 'https://m.media-amazon.com/images/G/01/LCXO_Station_Logos/FanCode2_White-Logo._AC_SL360_FMpng_.png',
    group: 'Live Sports Events',
    url: 'https://mix.drmlive.net/mix/fancode-2.m3u8?category=cricket',
    manifestType: 'hls',
    drmKey: null,
    drmType: null,
    referrer: 'https://fancode.com/',
    epgNow: 'Live Cricket & Sports Coverage',
    epgNext: 'Match Highlights & Post Analysis',
    progress: 60
  }
];

// Canonical Star Sports stream resolution: assigns 1080p Broadpeak feeds to HD channels and 576p feeds to SD channels
window.resolveStarSports = function(name) {
  if (!name) return null;
  const cleanName = name.toLowerCase().trim();
  const isActualStarSports = cleanName.includes('star sport') || cleanName.includes('star sports');
  if (!isActualStarSports) return null;

  // Check if channel name indicates High Definition (HD)
  const isHd = /\bhd\b|hd1|hd2/i.test(cleanName);

  if (isHd) {
    // --- High Definition (1080p) Broadpeak Feeds ---
    if (cleanName.includes('hindi') || cleanName.includes('hin')) {
      if (cleanName.includes('2') || cleanName.includes('hd2')) {
        return { url: 'https://jt.drmlive.net/jiotvplus/1984.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1984' };
      }
      return { url: 'https://jt.drmlive.net/jiotvplus/1108.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1108' };
    }
    if (cleanName.includes('select')) {
      if (cleanName.includes('2') || cleanName.includes('hd2')) {
        return { url: 'https://jt.drmlive.net/jiotvplus/461.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=461' };
      }
      return { url: 'https://jt.drmlive.net/jiotvplus/460.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=460' };
    }
    if (cleanName.includes('tamil') || cleanName.includes('tam')) {
      if (cleanName.includes('2') || cleanName.includes('hd2')) {
        return { url: 'https://jt.drmlive.net/jiotvplus/3273.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=3273' };
      }
      return { url: 'https://jt.drmlive.net/jiotvplus/3277.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=3277' };
    }
    if (cleanName.includes('telugu') || cleanName.includes('tel')) {
      if (cleanName.includes('2') || cleanName.includes('hd2')) {
        return { url: 'https://jt.drmlive.net/jiotvplus/3274.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=3274' };
      }
      return { url: 'https://jt.drmlive.net/jiotvplus/3278.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=3278' };
    }
    if (cleanName.includes('2') || cleanName.includes('hd2')) {
      return { url: 'https://jt.drmlive.net/jiotvplus/1109.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1109' };
    }
    return { url: 'https://jt.drmlive.net/jiotvplus/1106.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1106' };
  } else {
    // --- Standard Definition (576p) Broadpeak Feeds ---
    if (cleanName.includes('hindi') || cleanName.includes('hin')) {
      if (cleanName.includes('2')) {
        return { url: 'https://jt.drmlive.net/jiotvplus/1985.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1985' };
      }
      return { url: 'https://jt.drmlive.net/jiotvplus/362.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=362' };
    }
    if (cleanName.includes('select')) {
      if (cleanName.includes('2')) {
        return { url: 'https://jt.drmlive.net/jiotvplus/1114.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1114' };
      }
      return { url: 'https://jt.drmlive.net/jiotvplus/1123.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1123' };
    }
    if (cleanName.includes('tamil') || cleanName.includes('tam')) {
      if (cleanName.includes('2')) {
        return { url: 'https://jt.drmlive.net/jiotvplus/2853.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=2853' };
      }
      return { url: 'https://jt.drmlive.net/jiotvplus/1124.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1124' };
    }
    if (cleanName.includes('telugu') || cleanName.includes('tel')) {
      if (cleanName.includes('2')) {
        return { url: 'https://jt.drmlive.net/jiotvplus/2852.mpd', key: 'https://jt.drmlive.net/jiotvplus/2852' };
      }
      return { url: 'https://jt.drmlive.net/jiotvplus/1651.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1651' };
    }
    if (cleanName.includes('kannada') || cleanName.includes('kan')) {
      if (cleanName.includes('2')) {
        return { url: 'https://jt.drmlive.net/jiotvplus/1122.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1122' };
      }
      return { url: 'https://jt.drmlive.net/jiotvplus/1650.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1650' };
    }
    if (cleanName.includes('khel')) {
      return { url: 'https://jt.drmlive.net/jiotvplus/1998.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1998' };
    }
    if (cleanName.includes('3')) {
      return { url: 'https://jt.drmlive.net/jiotvplus/1389.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1389' };
    }
    if (cleanName.includes('2')) {
      return { url: 'https://jt.drmlive.net/jiotvplus/1141.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1141' };
    }
    return { url: 'https://jt.drmlive.net/jiotvplus/1142.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1142' };
  }
};

class M3UParser {
  /**
   * Parse raw M3U text into an array of channel objects
   * @param {string} text
   * @returns {Array<Object>}
   */
  static parse(text) {
    if (!text || typeof text !== 'string') return [];

    const lines = text.split(/\r?\n/);
    const channels = [];
    let pendingMeta = {};
    let channelNumber = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('#KODIPROP:')) {
        const prop = line.substring(10);
        const eqIdx = prop.indexOf('=');
        if (eqIdx !== -1) {
          const key = prop.substring(0, eqIdx).trim().toLowerCase();
          const val = prop.substring(eqIdx + 1).trim();
          if (key === 'inputstream.adaptive.license_type') {
            pendingMeta.drmType = val.toLowerCase();
          } else if (key === 'inputstream.adaptive.license_key') {
            pendingMeta.drmKey = val;
          } else if (key === 'inputstream.adaptive.manifest_type') {
            pendingMeta.manifestType = val.toLowerCase();
          }
        }
      } else if (line.startsWith('#EXTVLCOPT:')) {
        const prop = line.substring(11);
        const eqIdx = prop.indexOf('=');
        if (eqIdx !== -1) {
          const key = prop.substring(0, eqIdx).trim().toLowerCase();
          const val = prop.substring(eqIdx + 1).trim();
          if (key === 'http-user-agent') {
            pendingMeta.userAgent = val;
          } else if (key === 'http-referrer') {
            pendingMeta.referrer = val;
          }
        }
      } else if (line.startsWith('#EXTINF:')) {
        pendingMeta.extinf = line;
      } else if (!line.startsWith('#') && (line.startsWith('http://') || line.startsWith('https://') || line.startsWith('/'))) {
        // Stream URL line
        const extinfLine = pendingMeta.extinf || '';

        // Clean pipe delimiters (|Referer=..., |User-Agent=...) from stream URL
        let cleanUrl = line.trim();
        let pipeReferer = null;
        let pipeUserAgent = null;

        if (cleanUrl.includes('|')) {
          const parts = cleanUrl.split('|');
          cleanUrl = parts[0].trim();
          for (let p = 1; p < parts.length; p++) {
            const part = parts[p].trim();
            if (part.toLowerCase().startsWith('referer=')) {
              pipeReferer = part.substring(8).trim();
            } else if (part.toLowerCase().startsWith('user-agent=')) {
              pipeUserAgent = part.substring(11).trim();
            }
          }
        }

        const channel = {
          id: 'ch-' + channelNumber,
          num: channelNumber,
          name: 'Channel ' + channelNumber,
          logo: '',
          group: 'General',
          url: cleanUrl,
          drmType: pendingMeta.drmType || null,
          drmKey: pendingMeta.drmKey || null,
          manifestType: pendingMeta.manifestType || (cleanUrl.includes('.mpd') ? 'dash' : (cleanUrl.includes('.m3u8') ? 'hls' : null)),
          userAgent: pipeUserAgent || pendingMeta.userAgent || null,
          referrer: pipeReferer || pendingMeta.referrer || null,
          epgNow: 'Live Broadcast',
          epgNext: 'Upcoming Program',
          progress: Math.floor(Math.random() * 80) + 10
        };

        if (cleanUrl.includes('fancode') && !channel.referrer) {
          channel.referrer = 'https://fancode.com/';
        } else if ((cleanUrl.includes('suluv') || cleanUrl.includes('sliv')) && !channel.referrer) {
          channel.referrer = 'https://la.drmlive.net/';
        }

        if (extinfLine) {
          const tvgNameMatch = extinfLine.match(/tvg-name="([^"]*)"/i);
          const tvgLogoMatch = extinfLine.match(/tvg-logo="([^"]*)"/i);
          const groupTitleMatch = extinfLine.match(/group-title="([^"]*)"/i);
          const tvgIdMatch = extinfLine.match(/tvg-id="([^"]*)"/i);

          if (tvgLogoMatch && tvgLogoMatch[1]) {
            channel.logo = tvgLogoMatch[1].trim();
          }
          if (groupTitleMatch && groupTitleMatch[1]) {
            channel.group = groupTitleMatch[1].trim();
          }
          if (tvgIdMatch && tvgIdMatch[1]) {
            channel.tvgId = tvgIdMatch[1].trim();
          }

          const commaIndex = extinfLine.lastIndexOf(',');
          if (commaIndex !== -1) {
            const rawName = extinfLine.substring(commaIndex + 1).trim();
            if (rawName) channel.name = rawName;
          } else if (tvgNameMatch && tvgNameMatch[1]) {
            channel.name = tvgNameMatch[1].trim();
          }
        }

        // Remap known broken relays to live working streams
        const STREAM_MAP = {
          'star-35.mpd': { url: 'https://jt.drmlive.net/jiotvplus/1142.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1142', manifestType: 'dash', drmType: 'clearkey' },
          'star-33.mpd': { url: 'https://jt.drmlive.net/jiotvplus/1141.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1141', manifestType: 'dash', drmType: 'clearkey' },
          'star-25.mpd': { url: 'https://jt.drmlive.net/jiotvplus/362.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=362', manifestType: 'dash', drmType: 'clearkey' },
          'star-34.mpd': { url: 'https://jt.drmlive.net/jiotvplus/1123.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1123', manifestType: 'dash', drmType: 'clearkey' },
          'star-24.mpd': { url: 'https://jt.drmlive.net/jiotvplus/1114.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1114', manifestType: 'dash', drmType: 'clearkey' },
          'sportsfancode.mpd': { url: 'https://mix.drmlive.net/mix/fancode-1.m3u8?category=cricket', manifestType: 'hls', drmType: null, key: null, referrer: 'https://fancode.com/' },
          'sportsfancode2.mpd': { url: 'https://mix.drmlive.net/mix/fancode-2.m3u8?category=cricket', manifestType: 'hls', drmType: null, key: null, referrer: 'https://fancode.com/' },
          'sportswillows.mpd': { url: 'https://la.drmlive.net/tp/sling-2406.mpd', key: 'https://la.drmlive.net/tp/sling_ck?id=2406', manifestType: 'dash', drmType: 'clearkey' },
        };
        for (const [frag, target] of Object.entries(STREAM_MAP)) {
          if (channel.url && channel.url.includes(frag)) {
            channel.url = target.url;
            channel.drmKey = target.key || null;
            channel.drmType = target.drmType || null;
            channel.manifestType = target.manifestType || 'hls';
            channel.referrer = target.referrer || ((target.url.includes('jiotvplus') || target.url.includes('jt.drmlive.net')) ? null : channel.referrer);
            break;
          }
        }

        const cNameClean = (channel.name || '').toLowerCase().trim();
        if (cNameClean === 'fancode' || cNameClean === 'fancode 1' || cNameClean === 'fancode event 1') {
          channel.url = 'https://mix.drmlive.net/mix/fancode-1.m3u8?category=cricket';
          channel.manifestType = 'hls';
          channel.drmKey = null;
          channel.drmType = null;
          channel.referrer = 'https://fancode.com/';
        } else if (cNameClean === 'fancode 2' || cNameClean === 'fancode event 2') {
          channel.url = 'https://mix.drmlive.net/mix/fancode-2.m3u8?category=cricket';
          channel.manifestType = 'hls';
          channel.drmKey = null;
          channel.drmType = null;
          channel.referrer = 'https://fancode.com/';
        }

        // Canonical mapping for all Star Sports channels to Broadpeak live feeds
        if (cNameClean.includes('star sport') || cNameClean.includes('star sports')) {
          const starRes = window.resolveStarSports(cNameClean);
          if (starRes) {
            channel.url = starRes.url;
            channel.drmKey = starRes.key;
            channel.drmType = 'clearkey';
            channel.manifestType = 'dash';
            channel.referrer = null;
          }
        }

        // Identify content source platform
        const srcInfo = M3UParser.identifySource(channel.url, channel.name);
        channel.source = srcInfo.name;
        channel.sourceId = srcInfo.id;
        channel.sourceBadge = srcInfo.badge;
        channel.sourceColor = srcInfo.color;
        channel.sourceFormat = srcInfo.format;

        channels.push(channel);
        channelNumber++;
        pendingMeta = {};
      }
    }

    return channels;
  }

  /**
   * Fetch and parse an M3U playlist from a remote URL with OTT Navigator User-Agent
   * @param {string} url
   * @param {Function} [onStatusUpdate]
   * @param {string} [userAgent]
   * @returns {Promise<Array<Object>>}
   */
  static async fetchFromUrl(url, onStatusUpdate = null, userAgent = 'OTT Navigator/1.7.0.2') {
    if (!url || typeof url !== 'string') throw new Error('Playlist URL cannot be empty');
    url = url.trim();

    const notify = (msg) => {
      if (typeof onStatusUpdate === 'function') onStatusUpdate(msg);
    };

    notify(`Connecting with User-Agent: ${userAgent}...`);

    // Clean up UTF-8 BOM or whitespace
    const sanitizeText = (txt) => {
      if (!txt) return '';
      return txt.replace(/^\uFEFF/, '').trim();
    };

    // Construct sources - Priority 1 is our server proxy with the exact OTT Navigator User-Agent header
    const encodedUrl = encodeURIComponent(url);
    const encodedUa = encodeURIComponent(userAgent);

    const sources = [
      { 
        name: `OTT Navigator Proxy (${userAgent})`, 
        url: `/proxy?url=${encodedUrl}&ua=${encodedUa}` 
      },
      { 
        name: 'Local Server Cache', 
        url: '/playlist.m3u' 
      },
      { 
        name: 'Direct Connection', 
        url: url 
      },
      { 
        name: 'Cloud CORS Proxy 1', 
        url: `https://api.allorigins.win/raw?url=${encodedUrl}` 
      },
      { 
        name: 'Cloud CORS Proxy 2', 
        url: `https://corsproxy.io/?${encodedUrl}` 
      }
    ];

    let lastError = null;
    let m3uText = null;

    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      try {
        notify(`Fetching via ${src.name}...`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 18000);

        const response = await fetch(src.url, {
          signal: controller.signal,
          headers: { 'Accept': '*/*' }
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          const raw = await response.text();
          const clean = sanitizeText(raw);
          // Check if response has valid M3U or stream contents
          if (clean && (clean.includes('#EXTINF') || clean.includes('#EXTM3U') || clean.includes('http://') || clean.includes('https://'))) {
            m3uText = clean;
            notify(`Connected via ${src.name}`);
            break;
          }
        } else {
          lastError = new Error(`HTTP ${response.status} from ${src.name}`);
        }
      } catch (err) {
        lastError = err;
        console.warn(`Source ${src.name} failed:`, err);
      }
    }

    if (!m3uText) {
      throw new Error(
        lastError
          ? `Could not download playlist (${lastError.message || 'Network error'}). If this URL requires CORS headers in browser, you can also upload the .m3u file directly below.`
          : 'Could not fetch valid playlist data from this URL.'
      );
    }

    notify('Parsing channels & categories...');
    const channels = M3UParser.parse(m3uText);

    if (!channels || channels.length === 0) {
      throw new Error('Downloaded file does not contain any valid channel streams.');
    }

    notify(`Successfully parsed ${channels.length} channels!`);
    return channels;
  }

  /**
   * Group channels by their category
   * @param {Array<Object>} channels
   * @returns {Object}
   */
  static groupCategories(channels) {
    const groups = {
      'All': channels.length
    };

    channels.forEach(ch => {
      const g = ch.group || 'General';
      groups[g] = (groups[g] || 0) + 1;
    });

    return groups;
  }

  /**
   * Identify content source platform, badge, color, and format from stream URL
   * @param {string} url
   * @param {string} [name]
   * @returns {Object}
   */
  static identifySource(url, name = '') {
    const u = (url || '').toLowerCase();

    if (u.includes('jt.drmlive.net') || u.includes('jiotvplus')) {
      return { id: 'jio', name: 'JioTV+ (Broadpeak)', badge: 'JioTV+', color: '#0085ff', format: 'DASH ClearKey' };
    }
    if (u.includes('playboxtv')) {
      return { id: 'playbox', name: 'Playbox TV', badge: 'Playbox', color: '#a855f7', format: 'HLS Live' };
    }
    if (u.includes('xiaomi')) {
      return { id: 'xiaomi', name: 'Xiaomi MiTV', badge: 'Xiaomi', color: '#ff6900', format: 'HLS Live' };
    }
    if (u.includes('distro')) {
      return { id: 'distro', name: 'DistroTV', badge: 'DistroTV', color: '#10b981', format: 'HLS Live' };
    }
    if (u.includes('la.drmlive.net/tp/zee5') || u.includes('/zee5/')) {
      return { id: 'zee5', name: 'Zee5', badge: 'Zee5', color: '#f59e0b', format: 'Akamai HLS' };
    }
    const n = (name || '').toLowerCase();
    if (n.includes('event') || u.includes('fancode') || u.includes('primevwcb') || u.includes('sportsprime') || u.includes('icctv') || (u.includes('star-') && u.includes('.m3u8')) || (u.includes('suluv-') && u.includes('.m3u8'))) {
      return { id: 'sports_events', name: 'Live Sports Events', badge: 'Sports Event', color: '#f43f5e', format: 'Event Stream' };
    }
    if (u.includes('sliv') || u.includes('suluv') || u.includes('slivcdn')) {
      return { id: 'sonyliv', name: 'SonyLIV', badge: 'SonyLIV', color: '#00e5ff', format: 'Akamai AES' };
    }
    if (u.includes('la.drmlive.net/tp/') && (u.includes('.mpd') || u.includes('tpck'))) {
      return { id: 'tataplay', name: 'Tata Play', badge: 'Tata Play', color: '#ec4899', format: 'DASH Relay' };
    }
    if (n.includes('star sport') || (u.includes('star-') && u.includes('.mpd')) || u.includes('hotstar')) {
      return { id: 'hotstar', name: 'Hotstar / Star', badge: 'Hotstar', color: '#14b8a6', format: 'DASH Broadpeak' };
    }
    return { id: 'fast_direct', name: 'Direct / Regional FAST', badge: 'FAST', color: '#94a3b8', format: 'HLS Direct' };
  }

  /**
   * Group channels by their content source
   * @param {Array<Object>} channels
   * @returns {Object}
   */
  static groupSources(channels) {
    const groups = {
      'All Sources': channels.length
    };

    channels.forEach(ch => {
      const s = ch.source || 'Direct / Regional FAST';
      groups[s] = (groups[s] || 0) + 1;
    });

    return groups;
  }
}

window.DEFAULT_CHANNELS = DEFAULT_CHANNELS;
window.M3UParser = M3UParser;
window.STAR_STREAM_MAP = {
  'star-35.mpd': { url: 'https://jt.drmlive.net/jiotvplus/1142.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1142' },
  'star-33.mpd': { url: 'https://jt.drmlive.net/jiotvplus/1141.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1141' },
  'star-25.mpd': { url: 'https://jt.drmlive.net/jiotvplus/362.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=362' },
  'star-34.mpd': { url: 'https://jt.drmlive.net/jiotvplus/1123.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1123' },
  'star-24.mpd': { url: 'https://jt.drmlive.net/jiotvplus/1114.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1114' },
};
window.FANCODE_STREAM_MAP = {
  'sportsfancode.mpd': { url: 'https://mix.drmlive.net/mix/fancode-1.m3u8?category=cricket', manifestType: 'hls' },
  'sportsfancode2.mpd': { url: 'https://mix.drmlive.net/mix/fancode-2.m3u8?category=cricket', manifestType: 'hls' },
};
