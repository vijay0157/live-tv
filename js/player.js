/**
 * OTT Navigator for LG webOS - Video Player Engine (Hls.js + OSD + Quick Zapper)
 */

class VideoPlayer {
  constructor() {
    this.container = document.getElementById('player-container');
    this.video = document.getElementById('video-element');
    this.bufferingIndicator = document.getElementById('player-buffering');
    this.errorOverlay = document.getElementById('player-error');
    this.errorTitle = document.getElementById('player-error-title');
    this.errorDetail = document.getElementById('player-error-detail');
    this.osd = document.getElementById('player-osd');
    this.quickZapper = document.getElementById('quick-zapper');

    // UI elements inside OSD
    this.osdChannelLogo = document.getElementById('osd-channel-logo');
    this.osdChannelName = document.getElementById('osd-channel-name');
    this.osdProgramName = document.getElementById('osd-program-name');
    this.osdQualityBadge = document.getElementById('osd-quality-badge');
    this.osdProgressFill = document.getElementById('osd-progress-fill');
    this.osdTimeInfo = document.getElementById('osd-time-info');

    this.currentChannel = null;
    this.hls = null;
    this.shaka = null;
    this.osdTimeout = null;
    this.playbackWatchdog = null;
    this.aspectRatios = ['contain', 'fit-cover', 'fit-fill'];
    this.currentAspectIndex = 0;

    this.initPlayerEvents();
    this.initShaka();
  }

  showError(title, detail) {
    clearTimeout(this.playbackWatchdog);
    this.showBuffering(false);
    this.setQualityBadge('Offline');
    if (this.errorOverlay) {
      if (title && this.errorTitle) this.errorTitle.textContent = title;
      if (detail && this.errorDetail) this.errorDetail.textContent = detail;
      this.errorOverlay.style.display = 'flex';
      this.revealOSD();
    }
  }

  hideError() {
    if (this.errorOverlay) {
      this.errorOverlay.style.display = 'none';
    }
  }

  isErrorVisible() {
    return this.errorOverlay && this.errorOverlay.style.display === 'flex';
  }

  retryCurrentChannel() {
    if (this.currentChannel) {
      this.hideError();
      this.play(this.currentChannel);
    }
  }

  initShaka() {
    if (window.shaka) {
      try {
        window.shaka.polyfill.installAll();

        // ClearKey EME & MediaCapabilities Compatibility:
        // Chromium's org.w3.clearkey CDM only declares avc1 in its capabilities list,
        // which rejects hvc1 with Error 6001 during requestMediaKeySystemAccess and
        // mediaCapabilities.decodingInfo even when the platform decodes HEVC.
        let cachedClearKeyAccess = null;
        if (navigator.requestMediaKeySystemAccess) {
          navigator.requestMediaKeySystemAccess('org.w3.clearkey', [{
            initDataTypes: ['keyids', 'cenc'],
            audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }],
            videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.64001F"' }]
          }]).then(access => {
            cachedClearKeyAccess = access;
          }).catch(e => {
            console.warn('[Player] Initial ClearKey baseline access query notice:', e);
          });
        }

        // Intercept navigator.mediaCapabilities.decodingInfo:
        if (navigator.mediaCapabilities && navigator.mediaCapabilities.decodingInfo) {
          const origDecodingInfo = navigator.mediaCapabilities.decodingInfo.bind(navigator.mediaCapabilities);
          navigator.mediaCapabilities.decodingInfo = async function(cfg) {
            if (cfg && cfg.keySystemConfiguration && cfg.keySystemConfiguration.keySystem === 'org.w3.clearkey') {
              if (cfg.video && cfg.video.contentType && (cfg.video.contentType.includes('hvc1') || cfg.video.contentType.includes('hev1'))) {
                return {
                  supported: true,
                  smooth: true,
                  powerEfficient: true,
                  keySystemAccess: cachedClearKeyAccess,
                  keySystemConfiguration: {
                    keySystem: 'org.w3.clearkey',
                    initDataType: cfg.keySystemConfiguration.initDataType || 'cenc'
                  }
                };
              }
            }
            return origDecodingInfo(cfg);
          };
        }

        // Intercept navigator.requestMediaKeySystemAccess:
        if (navigator.requestMediaKeySystemAccess) {
          const origRMKSA = navigator.requestMediaKeySystemAccess.bind(navigator);
          navigator.requestMediaKeySystemAccess = async function(keySystem, configs) {
            if (keySystem === 'org.w3.clearkey' && configs && Array.isArray(configs)) {
              const originalVideoTypes = [];
              const patchedConfigs = JSON.parse(JSON.stringify(configs));
              for (const cfg of patchedConfigs) {
                if (cfg.videoCapabilities) {
                  for (const vc of cfg.videoCapabilities) {
                    if (vc.contentType && (vc.contentType.includes('hvc1') || vc.contentType.includes('hev1'))) {
                      originalVideoTypes.push(vc.contentType);
                      vc.contentType = 'video/mp4; codecs="avc1.64001F"';
                    }
                  }
                }
              }
              const access = await origRMKSA(keySystem, patchedConfigs);
              if (!cachedClearKeyAccess) cachedClearKeyAccess = access;
              const origGetConfig = access.getConfiguration.bind(access);
              access.getConfiguration = function() {
                const cfg = origGetConfig();
                if (cfg.videoCapabilities && originalVideoTypes.length > 0) {
                  const restored = [];
                  for (const vt of originalVideoTypes) {
                    restored.push({
                      contentType: vt,
                      robustness: '',
                      encryptionScheme: null
                    });
                  }
                  cfg.videoCapabilities = restored.concat(cfg.videoCapabilities);
                }
                return cfg;
              };
              return access;
            }
            return origRMKSA(keySystem, configs);
          };
        }

        // MediaSource HEVC capability polyfill for Chromium / webOS:
        if (window.MediaSource && window.MediaSource.isTypeSupported) {
          const origIsTypeSupported = window.MediaSource.isTypeSupported.bind(window.MediaSource);
          window.MediaSource.isTypeSupported = function(type) {
            if (type && (type.includes('hvc1') || type.includes('hev1'))) {
              return true;
            }
            return origIsTypeSupported(type);
          };
        }

        if (window.shaka.Player.isBrowserSupported()) {
          this.shaka = new window.shaka.Player(this.video);
          this.shaka.addEventListener('error', (event) => {
            const err = event.detail;
            if (!err) return;
            // Benign channel-switch aborts:
            if (err.code === 7000 || err.code === 7001) {
              console.log('[Shaka] Ignored benign channel-switch abort:', err.code);
              return;
            }
            // Code 3015 during load will be handled by the catch(shakaErr) block in play():
            if (err.code === 3015) {
              console.warn('[Shaka] MediaSource operation threw (handled in play catch):', err);
              return;
            }
            console.error('Shaka Player error:', err);
            clearTimeout(this.playbackWatchdog);
            this.showBuffering(false);
            this.showError(
              'Stream Offline or Unreachable',
              `Playback failed for ${this.currentChannel?.name || 'this channel'}: stream is offline or license unavailable.`
            );
          });
          // Universal CORS & Segment Proxy:
          // Intercept all outgoing Shaka requests (manifests, segments, license challenges)
          // and route them through our local /proxy endpoint with OTT Navigator headers and CORS
          this.shaka.getNetworkingEngine().registerRequestFilter((type, request) => {
            if (!request.uris || request.uris.length === 0) return;
            const originalUri = request.uris[0];
            if (!originalUri) return;

            // Only proxy external HTTP(S) URLs that are not already routed through /proxy
            if ((originalUri.startsWith('http://') || originalUri.startsWith('https://')) &&
                !originalUri.includes('/proxy?url=') &&
                !originalUri.includes('localhost:') &&
                !originalUri.includes('127.0.0.1:')) {
              const userAgent = localStorage.getItem('ott_user_agent') || 'OTT Navigator/1.7.0.2';
              let proxied = `/proxy?url=${encodeURIComponent(originalUri)}&ua=${encodeURIComponent(userAgent)}`;
              const isBroadpeakOrJio = originalUri.includes('cdn.jio.com') || originalUri.includes('jiotvplus') || originalUri.includes('jt.drmlive.net');
              if (this.currentChannel && this.currentChannel.referrer && !isBroadpeakOrJio) {
                proxied += `&ref=${encodeURIComponent(this.currentChannel.referrer)}`;
              }
              request.uris[0] = proxied;
            }
          });

          console.log('Shaka Player initialized with EME & ClearKey DRM support');
        }
      } catch (e) {
        console.warn('Shaka initialization warning:', e);
      }
    }
  }

  initPlayerEvents() {
    if (!this.video) return;

    this.video.addEventListener('waiting', () => this.showBuffering(true));
    this.video.addEventListener('playing', () => {
      clearTimeout(this.playbackWatchdog);
      this.showBuffering(false);
      this.hideError();
    });
    this.video.addEventListener('canplay', () => {
      clearTimeout(this.playbackWatchdog);
      this.showBuffering(false);
      this.hideError();
    });
    this.video.addEventListener('timeupdate', () => {
      if (this.video && (this.video.currentTime > 0 || this.video.readyState >= 2)) {
        clearTimeout(this.playbackWatchdog);
        this.showBuffering(false);
        this.hideError();
      }
    });
    this.video.addEventListener('error', (e) => {
      if (this.isSwitchingChannel) return;
      if (!this.video || (!this.video.src && !this.video.currentSrc)) return;
      clearTimeout(this.playbackWatchdog);
      this.showBuffering(false);
      console.error('Video error encountered:', e);
      this.showError(
        'Stream Offline or Unreachable',
        `Playback error encountered on ${this.currentChannel?.name || 'this channel'}. The stream is currently offline.`
      );
      if (window.app) window.app.showToast('Stream playback error. Stream is currently offline.');
    });

    // LG Magic Remote / mouse move reveals OSD
    this.container.addEventListener('mousemove', () => this.revealOSD());
    this.container.addEventListener('click', (e) => {
      if (e.target === this.video) {
        this.toggleOSD();
      }
    });
  }

  isActive() {
    return this.container && this.container.style.display === 'block';
  }

  base64UrlToHex(b64url) {
    if (!b64url) return '';
    let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    try {
      const raw = atob(b64);
      let hex = '';
      for (let i = 0; i < raw.length; i++) {
        const h = raw.charCodeAt(i).toString(16);
        hex += (h.length === 1 ? '0' : '') + h;
      }
      return hex.toLowerCase();
    } catch (e) {
      console.warn('base64UrlToHex conversion error:', e);
      return '';
    }
  }

  async resolveStreamUrl(streamUrl, userAgent) {
    try {
      const res = await fetch(`/resolve?url=${encodeURIComponent(streamUrl)}&ua=${encodeURIComponent(userAgent)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.url && data.url.startsWith('http')) {
          return data.url;
        }
      }
    } catch (e) {
      console.warn('Stream resolve error, using original URL:', e);
    }
    return streamUrl;
  }

  async fetchClearKeysFromUrl(licenseUrl, userAgent) {
    const clearKeys = {};
    if (licenseUrl.includes('chlajabsdk') || licenseUrl.includes('allowipmpd_key.php')) {
      clearKeys['03c2e0af2f8159f9f0ce9b5dbc865f10'] = 'cd84ed136b0cc71f8ab8cd4d4f6a2e4c';
      return clearKeys;
    }

    if (licenseUrl.includes('sports_key.php') || licenseUrl.includes('fancode') || licenseUrl.includes('willow')) {
      const sportsMasterKey = '36ee40e58948ca15e3caba8d4768f34b';
      clearKeys['82dfca238e8c4b430a3269db71965db9'] = sportsMasterKey; // Fancode 1
      clearKeys['1994b1df7dfd2e8a8d7b9bf3fb900285'] = sportsMasterKey; // Fancode 2
      clearKeys['290e09c837da78d5cd961978d390515c'] = sportsMasterKey; // Willow Sports
      clearKeys['60c0d9b41475e01ef4ffb91ed557fbcc'] = sportsMasterKey; // JWK KID
    } else if (licenseUrl.includes('sling_ck')) {
      const slingKey = 'cd84ed136b0cc71f8ab8cd4d4f6a2e4c';
      clearKeys['0a4390fb253042f7b300adb90f250ae5'] = slingKey;
      clearKeys['b5c62824ad6f434494267f1947105f25'] = slingKey;
      clearKeys['75e11a9dcb3b4c7c813ce5b4c24e0349'] = slingKey;
      clearKeys['03c2e0af2f8159f9f0ce9b5dbc865f10'] = slingKey;
    }

    try {
      const payload = JSON.stringify({
        kids: ['AAECAwQFBgcICQoLDA0ODw=='],
        type: 'temporary'
      });
      const res = await fetch(`/proxy?url=${encodeURIComponent(licenseUrl)}&ua=${encodeURIComponent(userAgent)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.keys)) {
          for (const item of data.keys) {
            if (item.kid && item.k) {
              const kidHex = this.base64UrlToHex(item.kid);
              const keyHex = this.base64UrlToHex(item.k);
              if (kidHex && keyHex) {
                clearKeys[kidHex] = keyHex;
              }
            }
          }
        }
      }
    } catch (e) {
      console.warn('Failed to pre-fetch ClearKeys from license URL:', e);
    }
    return clearKeys;
  }

  getFallbackChannel(channel) {
    if (!channel) return null;
    const cleanName = (channel.name || '').toLowerCase().trim();
    const url = (channel.url || '').toLowerCase();

    const FALLBACK_MAP = {
      // Zee Network Feeds (1080p / 720p HLS)
      'zee tv': { url: 'https://la.drmlive.net/tp/zee5/zeetvhd/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      'zee cinema': { url: 'https://la.drmlive.net/tp/zee5/zeecinemahd/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      'zee marathi': { url: 'https://la.drmlive.net/tp/zee5/zeemarathi/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      'zee bangla': { url: 'https://la.drmlive.net/tp/zee5/zeebangla/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      'zee telugu': { url: 'https://la.drmlive.net/tp/zee5/zeetelugu/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      'zee tamil': { url: 'https://la.drmlive.net/tp/zee5/zeetamil/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      'zee kannada': { url: 'https://la.drmlive.net/tp/zee5/zeekannada/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      'zee keralam': { url: 'https://la.drmlive.net/tp/zee5/129/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      'zee talkies': { url: 'https://la.drmlive.net/tp/zee5/zeetalkies/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      'and pictures': { url: 'https://la.drmlive.net/tp/zee5/tvpictureshd/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      '&pictures': { url: 'https://la.drmlive.net/tp/zee5/tvpictureshd/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      'and tv': { url: 'https://la.drmlive.net/tp/zee5/tvhd_0/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      '&tv': { url: 'https://la.drmlive.net/tp/zee5/tvhd_0/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      'zee news': { url: 'https://la.drmlive.net/tp/zee5/zeenews/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      'zee business': { url: 'https://la.drmlive.net/tp/zee5/zeebusiness/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      'zee yuva': { url: 'https://la.drmlive.net/tp/zee5/zeeyuva/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      'zee zest': { url: 'https://la.drmlive.net/tp/zee5/348/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      'zee classic': { url: 'https://la.drmlive.net/tp/zee5/176/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      'zee action': { url: 'https://la.drmlive.net/tp/zee5/zeeaction/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      'zee bollywood': { url: 'https://la.drmlive.net/tp/zee5/zeeclassic/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      'zee thirai': { url: 'https://la.drmlive.net/tp/zee5/224/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      'wion': { url: 'https://la.drmlive.net/tp/zee5/wion/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      'aaj tak': { url: 'https://la.drmlive.net/tp/zee5/aajtak/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },
      'india today': { url: 'https://la.drmlive.net/tp/zee5/indiatoday/index.m3u8', manifestType: 'hls', referrer: 'https://www.zee5.com/' },

      // Sony Network Feeds (SonyLIV broadcast)
      'sony sab': { url: 'https://la.drmlive.net/tp/sliv-sab.m3u8', manifestType: 'hls', referrer: 'https://la.drmlive.net/' },
      'sony max': { url: 'https://la.drmlive.net/tp/sliv-maxhd.m3u8', manifestType: 'hls', referrer: 'https://la.drmlive.net/' },
      'sony max 2': { url: 'https://la.drmlive.net/tp/sliv-max2.m3u8', manifestType: 'hls', referrer: 'https://la.drmlive.net/' },
      'sony max2': { url: 'https://la.drmlive.net/tp/sliv-max2.m3u8', manifestType: 'hls', referrer: 'https://la.drmlive.net/' },
      'sony ten 1': { url: 'https://la.drmlive.net/tp/sliv-ten1hd.m3u8', manifestType: 'hls', referrer: 'https://la.drmlive.net/' },
      'sony ten 2': { url: 'https://la.drmlive.net/tp/sliv-ten2hd.m3u8', manifestType: 'hls', referrer: 'https://la.drmlive.net/' },
      'sony ten 3': { url: 'https://la.drmlive.net/tp/sliv-ten3hd.m3u8', manifestType: 'hls', referrer: 'https://la.drmlive.net/' },
      'sony ten 4': { url: 'https://la.drmlive.net/tp/sliv-ten4hd.m3u8', manifestType: 'hls', referrer: 'https://la.drmlive.net/' },
      'sony ten 5': { url: 'https://la.drmlive.net/tp/sliv-ten5hd.m3u8', manifestType: 'hls', referrer: 'https://la.drmlive.net/' },
      'sony sports ten 1': { url: 'https://la.drmlive.net/tp/sliv-ten1hd.m3u8', manifestType: 'hls', referrer: 'https://la.drmlive.net/' },
      'sony sports ten 2': { url: 'https://la.drmlive.net/tp/sliv-ten2hd.m3u8', manifestType: 'hls', referrer: 'https://la.drmlive.net/' },
      'sony sports ten 3': { url: 'https://la.drmlive.net/tp/sliv-ten3hd.m3u8', manifestType: 'hls', referrer: 'https://la.drmlive.net/' },
      'sony sports ten 4': { url: 'https://la.drmlive.net/tp/sliv-ten4hd.m3u8', manifestType: 'hls', referrer: 'https://la.drmlive.net/' },
      'sony sports ten 5': { url: 'https://la.drmlive.net/tp/sliv-ten5hd.m3u8', manifestType: 'hls', referrer: 'https://la.drmlive.net/' },
      'sony bbc earth': { url: 'https://la.drmlive.net/tp/sliv-bbc.m3u8', manifestType: 'hls', referrer: 'https://la.drmlive.net/' },
      'sony pix': { url: 'https://la.drmlive.net/tp/sliv-pix.m3u8', manifestType: 'hls', referrer: 'https://la.drmlive.net/' },
      'sony pal': { url: 'https://la.drmlive.net/tp/sliv-pal.m3u8', manifestType: 'hls', referrer: 'https://la.drmlive.net/' },
      'sony wah': { url: 'https://la.drmlive.net/tp/sliv-wah.m3u8', manifestType: 'hls', referrer: 'https://la.drmlive.net/' },
      'sony marathi': { url: 'https://la.drmlive.net/tp/sliv-marathi.m3u8', manifestType: 'hls', referrer: 'https://la.drmlive.net/' },
      'sony yay': { url: 'https://la.drmlive.net/tp/sliv-yay.m3u8', manifestType: 'hls', referrer: 'https://la.drmlive.net/' },
      'set hd': { url: 'https://la.drmlive.net/tp/sliv-sab.m3u8', manifestType: 'hls', referrer: 'https://la.drmlive.net/' },

      // Colors Network Feeds
      'colors': { url: 'https://jt.drmlive.net/jiotvplus/1368.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1368', manifestType: 'dash', drmType: 'clearkey' },
      'colors hd': { url: 'https://jt.drmlive.net/jiotvplus/1368.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1368', manifestType: 'dash', drmType: 'clearkey' },

      // Star Network Feeds
      'star plus': { url: 'https://jt.drmlive.net/jiotvplus/1116.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1116', manifestType: 'dash', drmType: 'clearkey' },
      'star plus hd': { url: 'https://jt.drmlive.net/jiotvplus/1116.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1116', manifestType: 'dash', drmType: 'clearkey' },
      'star gold': { url: 'https://jt.drmlive.net/jiotvplus/1125.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1125', manifestType: 'dash', drmType: 'clearkey' },
      'star gold hd': { url: 'https://jt.drmlive.net/jiotvplus/1125.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1125', manifestType: 'dash', drmType: 'clearkey' },
      'star bharat': { url: 'https://jt.drmlive.net/jiotvplus/1127.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1127', manifestType: 'dash', drmType: 'clearkey' },
      'star bharat hd': { url: 'https://jt.drmlive.net/jiotvplus/1127.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1127', manifestType: 'dash', drmType: 'clearkey' },

      // History TV18 Feeds
      'history tv18': { url: 'https://jt.drmlive.net/jiotvplus/1471.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1471', manifestType: 'dash', drmType: 'clearkey' },
      'history tv18 hd': { url: 'https://jt.drmlive.net/jiotvplus/1471.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1471', manifestType: 'dash', drmType: 'clearkey' },
      'history 18': { url: 'https://jt.drmlive.net/jiotvplus/1471.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1471', manifestType: 'dash', drmType: 'clearkey' },
    };

    // ID-based lookup for JioTV+ channels
    const ID_FALLBACKS = {
      '167.mpd': FALLBACK_MAP['zee tv'],
      '165.mpd': FALLBACK_MAP['zee cinema'],
      '185.mpd': FALLBACK_MAP['and pictures'],
      '472.mpd': FALLBACK_MAP['and tv'],
      '471.mpd': FALLBACK_MAP['sony sab'],
      '476.mpd': FALLBACK_MAP['sony max'],
      '162.mpd': FALLBACK_MAP['sony ten 1'],
      '891.mpd': FALLBACK_MAP['sony ten 2'],
      '892.mpd': FALLBACK_MAP['sony ten 3'],
      '155.mpd': FALLBACK_MAP['sony ten 5'],
      '762.mpd': FALLBACK_MAP['sony pix'],
      '821.mpd': FALLBACK_MAP['sony bbc earth'],
      '1354.mpd': FALLBACK_MAP['zee telugu'],
      '1356.mpd': FALLBACK_MAP['zee tamil'],
      '1358.mpd': FALLBACK_MAP['zee talkies'],
      '1360.mpd': FALLBACK_MAP['zee marathi'],
      '1362.mpd': FALLBACK_MAP['zee kannada'],
      '1641.mpd': FALLBACK_MAP['zee keralam'],
      '144.mpd': FALLBACK_MAP['colors'],
      '1132.mpd': FALLBACK_MAP['star plus'],
      '156.mpd': FALLBACK_MAP['star gold'],
      '931.mpd': FALLBACK_MAP['star bharat'],
      '146.mpd': { url: 'https://jt.drmlive.net/jiotvplus/1471.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1471', manifestType: 'dash', drmType: 'clearkey' },
      '577.mpd': { url: 'https://jt.drmlive.net/jiotvplus/1471.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1471', manifestType: 'dash', drmType: 'clearkey' },
      '578.mpd': { url: 'https://jt.drmlive.net/jiotvplus/1471.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1471', manifestType: 'dash', drmType: 'clearkey' },
      '579.mpd': { url: 'https://jt.drmlive.net/jiotvplus/1471.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1471', manifestType: 'dash', drmType: 'clearkey' },
      '3510.mpd': FALLBACK_MAP['sony ten 1'],
      '3511.mpd': FALLBACK_MAP['sony ten 2'],
      '3512.mpd': FALLBACK_MAP['sony ten 3'],
      '3515.mpd': FALLBACK_MAP['sony ten 5'],
    };

    for (const [frag, target] of Object.entries(ID_FALLBACKS)) {
      if (url.includes(frag)) {
        const isJioTarget = target.url.includes('jiotvplus') || target.url.includes('jt.drmlive.net') || target.url.includes('cdn.jio.com');
        return {
          ...channel,
          url: target.url,
          manifestType: target.manifestType || 'hls',
          drmKey: target.key || null,
          drmType: target.drmType || null,
          referrer: target.referrer || (isJioTarget ? null : channel.referrer) || null
        };
      }
    }

    // Never downgrade an HD channel to an SD channel!
    const isHd = /\bhd\b|hd1|hd2/i.test(cleanName);
    if (isHd && cleanName.includes('star sport')) {
      return null;
    }

    // Name-based matching
    for (const [key, target] of Object.entries(FALLBACK_MAP)) {
      if (cleanName.includes(key)) {
        const isJioTarget = target.url.includes('jiotvplus') || target.url.includes('jt.drmlive.net') || target.url.includes('cdn.jio.com');
        return {
          ...channel,
          url: target.url,
          manifestType: target.manifestType || 'hls',
          drmKey: target.key || null,
          drmType: target.drmType || null,
          referrer: target.referrer || (isJioTarget ? null : channel.referrer) || null
        };
      }
    }

    return null;
  }

  getSdBroadcastFallback(channel) {
    if (!channel) return null;
    const cleanName = (channel.name || '').toLowerCase().trim();
    const url = (channel.url || '').toLowerCase();

    // Map Star Sports HD stream URLs and names to their corresponding broadcast feeds
    const HD_TO_SD_MAP = {
      '1106.mpd': { url: 'https://jt.drmlive.net/jiotvplus/1142.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1142' },
      '1108.mpd': { url: 'https://jt.drmlive.net/jiotvplus/362.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=362' },
      '1109.mpd': { url: 'https://jt.drmlive.net/jiotvplus/1141.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1141' },
      '460.mpd': { url: 'https://jt.drmlive.net/jiotvplus/1123.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1123' },
      '461.mpd': { url: 'https://jt.drmlive.net/jiotvplus/1114.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1114' },
      '1984.mpd': { url: 'https://jt.drmlive.net/jiotvplus/1985.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1985' },
      '3273.mpd': { url: 'https://jt.drmlive.net/jiotvplus/2853.mpd', key: 'https://jt.drmlive.net/jiotvplus/2853' },
      '3274.mpd': { url: 'https://jt.drmlive.net/jiotvplus/2852.mpd', key: 'https://jt.drmlive.net/jiotvplus/2852' },
      '3277.mpd': { url: 'https://jt.drmlive.net/jiotvplus/1124.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1124' },
      '3278.mpd': { url: 'https://jt.drmlive.net/jiotvplus/1651.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1651' },
    };

    for (const [frag, target] of Object.entries(HD_TO_SD_MAP)) {
      if (url.includes(frag)) {
        return {
          ...channel,
          url: target.url,
          drmKey: target.key,
          drmType: 'clearkey',
          manifestType: 'dash',
          isBroadcastStepdown: true
        };
      }
    }

    if (cleanName.includes('star sport')) {
      if (cleanName.includes('hindi') || cleanName.includes('hin')) {
        return { ...channel, url: 'https://jt.drmlive.net/jiotvplus/362.mpd', drmKey: 'https://jt.drmlive.net/jiotvplus/jtck?id=362', drmType: 'clearkey', manifestType: 'dash', isBroadcastStepdown: true };
      }
      if (cleanName.includes('select')) {
        return { ...channel, url: 'https://jt.drmlive.net/jiotvplus/1123.mpd', drmKey: 'https://jt.drmlive.net/jiotvplus/jtck?id=1123', drmType: 'clearkey', manifestType: 'dash', isBroadcastStepdown: true };
      }
      if (cleanName.includes('2')) {
        return { ...channel, url: 'https://jt.drmlive.net/jiotvplus/1141.mpd', drmKey: 'https://jt.drmlive.net/jiotvplus/jtck?id=1141', drmType: 'clearkey', manifestType: 'dash', isBroadcastStepdown: true };
      }
      return { ...channel, url: 'https://jt.drmlive.net/jiotvplus/1142.mpd', drmKey: 'https://jt.drmlive.net/jiotvplus/jtck?id=1142', drmType: 'clearkey', manifestType: 'dash', isBroadcastStepdown: true };
    }

    return null;
  }

  /**
   * Play a channel with Shaka (DASH & DRM) or Hls.js
   * @param {Object} channel
   */
  async play(channel) {
    if (!channel || !channel.url) return;
    this.currentChannel = channel;

    // Show container
    this.container.style.display = 'block';
    this.hideError();
    this.showBuffering(true);
    this.updateOSD();
    this.revealOSD();

    const isDashOrDrm = channel.manifestType === 'dash' || (channel.url && channel.url.includes('.mpd')) || !!channel.drmKey;
    const timeoutMs = isDashOrDrm ? 25000 : 15000;

    clearTimeout(this.playbackWatchdog);
    this.playbackWatchdog = setTimeout(() => {
      if (this.isActive() && this.video) {
        const isPlaying = !this.video.paused && (this.video.currentTime > 0 || this.video.readyState >= 2);
        if (!isPlaying && !this.isErrorVisible()) {
          console.warn('[Player] Playback watchdog timed out for', this.currentChannel?.name);
          this.showBuffering(false);
          this.showError(
            'Stream Offline or Unreachable',
            `${this.currentChannel?.name || 'Channel'} did not respond. The stream may be temporarily inactive or offline.`
          );
        }
      }
    }, timeoutMs);

    this.isSwitchingChannel = true;
    if (this.video) {
      try {
        this.video.pause();
        this.video.removeAttribute('src');
        this.video.load();
      } catch (e) {}
    }

    // Destroy existing HLS instance & unload Shaka
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.shaka) {
      try {
        await this.shaka.unload();
      } catch (e) {}
    }

    const cleanName = (channel.name || '').toLowerCase().trim();
    const isActualStarSports = cleanName.includes('star sport') || cleanName.includes('star sports');

    // Remap known broken relays to live working streams
    const STREAM_MAP = window.STREAM_MAP || {
      'star-35.mpd': { url: 'https://jt.drmlive.net/jiotvplus/1106.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1106', manifestType: 'dash', drmType: 'clearkey' },
      'star-33.mpd': { url: 'https://jt.drmlive.net/jiotvplus/1109.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1109', manifestType: 'dash', drmType: 'clearkey' },
      'star-25.mpd': { url: 'https://jt.drmlive.net/jiotvplus/1108.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=1108', manifestType: 'dash', drmType: 'clearkey' },
      'star-34.mpd': { url: 'https://jt.drmlive.net/jiotvplus/460.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=460', manifestType: 'dash', drmType: 'clearkey' },
      'star-24.mpd': { url: 'https://jt.drmlive.net/jiotvplus/461.mpd', key: 'https://jt.drmlive.net/jiotvplus/jtck?id=461', manifestType: 'dash', drmType: 'clearkey' },
      'sportsfancode.mpd': { url: 'https://mix.drmlive.net/mix/fancode-1.m3u8?category=cricket', manifestType: 'hls', drmType: null, key: null, referrer: 'https://fancode.com/' },
      'sportsfancode2.mpd': { url: 'https://mix.drmlive.net/mix/fancode-2.m3u8?category=cricket', manifestType: 'hls', drmType: null, key: null, referrer: 'https://fancode.com/' },
      'sportswillows.mpd': { url: 'https://la.drmlive.net/tp/sling-2406.mpd', key: 'https://la.drmlive.net/tp/sling_ck?id=2406', manifestType: 'dash', drmType: 'clearkey' },
    };
    for (const [frag, target] of Object.entries(STREAM_MAP)) {
      if (channel.url && channel.url.includes(frag)) {
        const isJioTarget = target.url.includes('jiotvplus') || target.url.includes('jt.drmlive.net') || target.url.includes('cdn.jio.com');
        channel = {
          ...channel,
          url: target.url,
          drmKey: target.key || null,
          drmType: target.drmType || null,
          manifestType: target.manifestType || 'hls',
          referrer: target.referrer || (isJioTarget ? null : channel.referrer) || null
        };
        this.currentChannel = channel;
        break;
      }
    }

    // Precise Star Sports stream resolution: preserves genuine 1080p HD feeds for HD channels and dedicated 576p feeds for SD channels
    if (isActualStarSports && !channel.isBroadcastStepdown && typeof window.resolveStarSports === 'function') {
      const starRes = window.resolveStarSports(cleanName);
      if (starRes) {
        channel = {
          ...channel,
          url: starRes.url,
          drmKey: starRes.key,
          drmType: 'clearkey',
          manifestType: 'dash',
          referrer: null
        };
        this.currentChannel = channel;
      }
    }

    // Direct mapping for Fancode & Fancode 2
    if (cleanName === 'fancode' || cleanName === 'fancode 1' || cleanName === 'fancode event 1') {
      channel = {
        ...channel,
        url: 'https://mix.drmlive.net/mix/fancode-1.m3u8?category=cricket',
        manifestType: 'hls',
        drmKey: null,
        drmType: null,
        referrer: 'https://fancode.com/'
      };
      this.currentChannel = channel;
    } else if (cleanName === 'fancode 2' || cleanName === 'fancode event 2') {
      channel = {
        ...channel,
        url: 'https://mix.drmlive.net/mix/fancode-2.m3u8?category=cricket',
        manifestType: 'hls',
        drmKey: null,
        drmType: null,
        referrer: 'https://fancode.com/'
      };
      this.currentChannel = channel;
    }

    const streamUrl = channel.url;
    const userAgent = localStorage.getItem('ott_user_agent') || 'OTT Navigator/1.7.0.2';
    const isDash = channel.manifestType === 'dash' || streamUrl.includes('.mpd');
    const hasDrm = !!channel.drmKey;

    // Loop activation promo channel, normal channels do not loop
    const isActivation = (channel.name && channel.name.toLowerCase().includes('activate playlist')) ||
                         (channel.drmKey && channel.drmKey.includes('chlajabsdk'));
    this.video.loop = isActivation;

    // 1. DASH (.mpd) or DRM Streams -> Play via Google Shaka Player!
    if (this.shaka && (isDash || hasDrm)) {
      console.log(`[Player] Using Shaka Player for ${channel.name} (${isDash ? 'DASH' : 'HLS'}, DRM: ${channel.drmType || 'none'})`);

      let clearKeys = {};

      if (channel.drmKey) {
        if (channel.drmKey.includes(':') && !channel.drmKey.startsWith('http')) {
          // Hex key pair: KEY_ID:KEY
          const [kid, key] = channel.drmKey.split(':');
          clearKeys[kid.trim().toLowerCase()] = key.trim().toLowerCase();
          console.log(`[Player] Loaded ClearKey hex: ${kid.trim()}`);
        } else if (channel.drmKey.startsWith('http')) {
          // Pre-fetch keys from license server URL
          console.log(`[Player] Pre-fetching ClearKeys from URL: ${channel.drmKey}`);
          const fetchedKeys = await this.fetchClearKeysFromUrl(channel.drmKey, userAgent);
          Object.assign(clearKeys, fetchedKeys);
          console.log(`[Player] Pre-fetched ${Object.keys(clearKeys).length} keys for ${channel.name}:`, clearKeys);
        }
      }

      // Ensure static activation key is applied
      if (isActivation) {
        clearKeys['03c2e0af2f8159f9f0ce9b5dbc865f10'] = 'cd84ed136b0cc71f8ab8cd4d4f6a2e4c';
      }

      this.shaka.configure({
        drm: {
          clearKeys: clearKeys,
          servers: {},
          preferredKeySystems: ['org.w3.clearkey'],
          advanced: {
            'org.w3.clearkey': {
              videoRobustness: '',
              audioRobustness: '',
              distinctiveIdentifierRequired: false,
              persistentStateRequired: false
            }
          }
        },
        manifest: {
          dash: {
            ignoreMinBufferTime: true,
            autoCorrectDrift: true,
            initialSegmentLimit: 2
          },
          retryParameters: {
            maxAttempts: 3,
            baseDelay: 500,
            backoffFactor: 1.5
          }
        },
        streaming: {
          bufferingGoal: 4,
          rebufferingGoal: 1,
          safeSeekOffset: 5,
          ignoreTextStreamFailures: true,
          alwaysStreamText: false,
          retryParameters: {
            maxAttempts: 3,
            baseDelay: 500,
            backoffFactor: 1.5
          }
        }
      });

      // Unwrap any nested /proxy?url=
      let realStreamUrl = streamUrl;
      while (realStreamUrl.startsWith('/proxy') || realStreamUrl.startsWith('proxy')) {
        const uMatch = realStreamUrl.match(/[?&]url=([^&]+)/);
        if (uMatch) {
          realStreamUrl = decodeURIComponent(uMatch[1]);
        } else {
          break;
        }
      }

      // Proxied stream URL ensures BaseURL rewrite and CORS headers
      let proxiedStream = `/proxy?url=${encodeURIComponent(realStreamUrl)}&ua=${encodeURIComponent(userAgent)}`;
      if (channel.referrer) {
        proxiedStream += `&ref=${encodeURIComponent(channel.referrer)}`;
      }
      console.log(`[Player] Loading proxied DASH stream: ${proxiedStream}`);

      try {
        const mimeType = isDash ? 'application/dash+xml' : undefined;
        await this.shaka.load(proxiedStream, null, mimeType);
        try {
          await this.video.play();
        } catch (playErr) {
          if (playErr.name !== 'AbortError') console.warn('[Player] video.play notice:', playErr);
        }
        if (channel.isBroadcastStepdown) {
          this.setQualityBadge('Broadcast Feed (576p SD)');
        } else if (isDash && channel.url && (channel.url.includes('1106') || channel.url.includes('1108') || channel.url.includes('1109') || channel.url.includes('460') || channel.url.includes('461') || channel.url.includes('1984') || channel.url.includes('3273') || channel.url.includes('3274') || channel.url.includes('3277') || channel.url.includes('3278'))) {
          this.setQualityBadge('1080p Full HD');
        } else {
          this.setQualityBadge(isDash ? 'DASH ClearKey' : 'HLS DRM');
        }
        this.showBuffering(false);
      } catch (shakaErr) {
        if (shakaErr && (shakaErr.code === 7000 || shakaErr.code === 7001)) {
          console.log('[Player] Shaka load was aborted by user channel change.');
          return;
        }
        console.warn('[Player] Shaka load failed code:', shakaErr ? shakaErr.code : null, 'category:', shakaErr ? shakaErr.category : null, 'message:', shakaErr ? shakaErr.message : null, 'data:', shakaErr ? shakaErr.data : null);

        // Hardware Decoder Fallback: If device lacks HEVC MSE hardware decode (Error 3015 / NotSupportedError),
        // step down to the broadcast stream so playback never fails on non-HEVC devices/browsers!
        const isCodecNotSupported = shakaErr && (
          shakaErr.code === 3015 ||
          (shakaErr.message && shakaErr.message.includes('unsupported')) ||
          (shakaErr.data && shakaErr.data.some && shakaErr.data.some(d => String(d).includes('NotSupportedError')))
        );

        if (isCodecNotSupported && !channel.isBroadcastStepdown) {
          const broadcastFallback = this.getSdBroadcastFallback(channel);
          if (broadcastFallback && broadcastFallback.url !== channel.url) {
            console.log(`[Player] Device lacks HEVC hardware decode. Stepping down ${channel.name} to broadcast feed:`, broadcastFallback.url);
            if (window.app) window.app.showToast('Browser lacks HEVC hardware decode. Playing broadcast feed. Open in Microsoft Edge or LG TV for Full 1080p HD.', 7000);
            this.play(broadcastFallback);
            return;
          }
        }

        const fallbackChannel = this.getFallbackChannel(channel);
        if (fallbackChannel && fallbackChannel.url !== channel.url) {
          console.log(`[Player] Falling back ${channel.name} to alternative stream:`, fallbackChannel.url);
          this.play(fallbackChannel);
          return;
        }
        this.showBuffering(false);
        this.setQualityBadge('Offline');
        this.showError(
          'Stream Offline or Unreachable',
          `${channel.name} returned an error and cannot be played. The stream may be currently offline or unreachable.`
        );
        if (window.app) window.app.showToast(`Playback Error: ${channel.name} is offline.`);
      }

      if (window.app) window.app.renderQuickZapper();
      return;
    }

    // 2. Standard HLS streams (.m3u8) -> Play via Hls.js
    if (window.Hls && window.Hls.isSupported() && (streamUrl.includes('.m3u8') || !streamUrl.includes('.mp4'))) {
      this.hls = new window.Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 60
      });

      // Unwrap any nested /proxy?url=
      let realStreamUrl = streamUrl;
      while (realStreamUrl.startsWith('/proxy') || realStreamUrl.startsWith('proxy')) {
        const uMatch = realStreamUrl.match(/[?&]url=([^&]+)/);
        if (uMatch) {
          realStreamUrl = decodeURIComponent(uMatch[1]);
        } else {
          break;
        }
      }

      let proxiedStream = `/proxy?url=${encodeURIComponent(realStreamUrl)}&ua=${encodeURIComponent(userAgent)}`;
      if (channel.referrer) {
        proxiedStream += `&ref=${encodeURIComponent(channel.referrer)}`;
      }

      console.log(`[Player] Loading proxied HLS stream: ${proxiedStream}`);
      this.hls.loadSource(proxiedStream);
      this.hls.attachMedia(this.video);

      this.hls.on(window.Hls.Events.MANIFEST_PARSED, (event, data) => {
        this.isSwitchingChannel = false;
        this.video.play().catch(e => console.log('Autoplay policy caught:', e));
        this.showBuffering(false);
        this.hideError();
        clearTimeout(this.playbackWatchdog);
        if (data.levels && data.levels.length > 0) {
          const maxLevel = data.levels[data.levels.length - 1];
          if (maxLevel && maxLevel.height) {
            this.setQualityBadge(maxLevel.height + 'p HLS');
          } else {
            this.setQualityBadge('HLS Live');
          }
        }
      });

      this.hls.on(window.Hls.Events.FRAG_BUFFERED, () => {
        this.showBuffering(false);
      });

      this.hls.on(window.Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case window.Hls.ErrorTypes.NETWORK_ERROR:
              if (data.details === window.Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
                  data.details === window.Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT ||
                  data.details === window.Hls.ErrorDetails.MANIFEST_PARSING_ERROR ||
                  (data.response && data.response.code >= 400)) {
                
                // Automatic fallback between Fancode feeds if one failed
                const chName = (this.currentChannel?.name || '').toLowerCase();
                const chUrl = (this.currentChannel?.url || '').toLowerCase();
                if ((chName.includes('fancode') || chUrl.includes('fancode')) && !this._fancodeFallbackDone) {
                  this._fancodeFallbackDone = true;
                  console.log('[Player] Fancode feed failed, falling back to alternative feed...');
                  const altUrl = chUrl.includes('fancode-1')
                    ? 'https://mix.drmlive.net/mix/fancode-2.m3u8?category=cricket'
                    : 'https://mix.drmlive.net/mix/fancode-1.m3u8?category=cricket';
                  this.currentChannel = {
                    ...this.currentChannel,
                    url: altUrl,
                    manifestType: 'hls',
                    drmKey: null,
                    drmType: null,
                    referrer: 'https://fancode.com/'
                  };
                  this.play(this.currentChannel);
                  return;
                }

                console.error('Fatal HLS manifest error:', data.details);
                clearTimeout(this.playbackWatchdog);
                this.hls.destroy();
                this.hls = null;
                this.showBuffering(false);
                this.setQualityBadge('Offline');
                this.showError('Stream Offline or Unreachable', `${channel.name} is currently offline or unreachable.`);
                break;
              }
              console.warn('HLS Network error encountered, attempting recovery...');
              this.hls.startLoad();
              break;
            case window.Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('HLS Media error, attempting recovery...');
              this.hls.recoverMediaError();
              break;
            default:
              console.error('Unrecoverable HLS error:', data);
              clearTimeout(this.playbackWatchdog);
              this.hls.destroy();
              this.hls = null;
              this.showBuffering(false);
              this.setQualityBadge('Offline');
              this.showError(
                'Stream Offline or Unreachable',
                `${channel.name} is currently offline or unreachable.`
              );
              if (window.app) window.app.showToast(`Stream Offline: ${channel.name} is unreachable.`);
              break;
          }
        }
      });
    } else if (this.video.canPlayType('application/vnd.apple.mpegurl') || streamUrl.endsWith('.mp4')) {
      // Native webOS / Safari video support
      let proxiedStream = streamUrl.startsWith('/proxy')
        ? streamUrl
        : `/proxy?url=${encodeURIComponent(streamUrl)}&ua=${encodeURIComponent(userAgent)}`;
      if (channel.referrer && !proxiedStream.includes('&ref=')) {
        proxiedStream += `&ref=${encodeURIComponent(channel.referrer)}`;
      }
      this.video.src = proxiedStream;
      this.video.play().catch(e => console.log('Autoplay policy caught:', e));
    } else {
      this.video.src = streamUrl;
      this.video.play().catch(() => {});
    }

    if (window.app) {
      window.app.renderQuickZapper();
    }
  }

  setQualityBadge(text) {
    const badge = document.getElementById('osd-quality-badge') || this.osdQualityBadge;
    if (badge) badge.textContent = text;
  }

  showBuffering(show) {
    if (!this.bufferingIndicator) return;
    this.bufferingIndicator.style.display = show ? 'flex' : 'none';
  }

  updateOSD() {
    if (!this.currentChannel) return;

    if (this.currentChannel.logo) {
      this.osdChannelLogo.src = this.currentChannel.logo;
      this.osdChannelLogo.style.display = 'block';
    } else {
      this.osdChannelLogo.style.display = 'none';
    }

    if (this.osdChannelName) {
      this.osdChannelName.innerHTML = `
        <span>CH ${this.currentChannel.num || 1} - ${this.currentChannel.name}</span>
        <span class="quality-badge" id="osd-quality-badge">1080p HD</span>
      `;
      this.osdQualityBadge = document.getElementById('osd-quality-badge');
    }

    if (this.osdProgramName) {
      this.osdProgramName.textContent = this.currentChannel.epgNow || 'Live Broadcast';
    }

    const progress = this.currentChannel.progress || 50;
    if (this.osdProgressFill) {
      this.osdProgressFill.style.width = progress + '%';
    }

    if (this.osdTimeInfo) {
      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      this.osdTimeInfo.innerHTML = `
        <span>Now: ${this.currentChannel.epgNow || 'Live Broadcast'} (${progress}%)</span>
        <span>Next: ${this.currentChannel.epgNext || 'Upcoming Show'} | Live ${timeStr}</span>
      `;
    }
  }

  revealOSD() {
    if (!this.osd) return;
    this.osd.classList.remove('hidden');

    clearTimeout(this.osdTimeout);
    this.osdTimeout = setTimeout(() => {
      if (!this.isQuickZapperOpen()) {
        this.osd.classList.add('hidden');
      }
    }, 4500);
  }

  toggleOSD() {
    if (this.osd.classList.contains('hidden')) {
      this.revealOSD();
    } else {
      this.osd.classList.add('hidden');
    }
  }

  cycleAspectRatio() {
    this.video.classList.remove(...this.aspectRatios);
    this.currentAspectIndex = (this.currentAspectIndex + 1) % this.aspectRatios.length;
    const newAspect = this.aspectRatios[this.currentAspectIndex];

    if (newAspect !== 'contain') {
      this.video.classList.add(newAspect);
    }

    const labels = ['Fit (Normal)', 'Cover (Zoom)', 'Fill (Stretch)'];
    if (window.app) {
      window.app.showToast(`Aspect Ratio: ${labels[this.currentAspectIndex]}`);
    }
    this.revealOSD();
  }

  togglePlayPause() {
    if (!this.video) return;
    if (this.video.paused) {
      this.video.play();
      if (window.app) window.app.showToast('Playback Resumed');
    } else {
      this.video.pause();
      if (window.app) window.app.showToast('Playback Paused');
    }
    this.revealOSD();
  }

  toggleQuickZapper() {
    if (!this.quickZapper) return;
    const isOpen = this.quickZapper.classList.toggle('open');
    if (isOpen) {
      this.revealOSD();
      const activeItem = this.quickZapper.querySelector('.quick-channel-item.active') || this.quickZapper.querySelector('.quick-channel-item');
      if (activeItem && window.remoteNav) {
        window.remoteNav.setFocus(activeItem);
      }
    } else {
      this.revealOSD();
    }
  }

  isQuickZapperOpen() {
    return this.quickZapper && this.quickZapper.classList.contains('open');
  }

  handleRemoteInput(keyCode, key) {
    // If error overlay is open, Enter/OK retries playback, Up/Down opens channel list
    if (this.isErrorVisible()) {
      if (keyCode === 13 || key === 'Enter') {
        this.retryCurrentChannel();
        return;
      }
      if (keyCode === 38 || keyCode === 40 || key === 'ArrowUp' || key === 'ArrowDown') {
        this.toggleQuickZapper();
        return;
      }
      if (keyCode === 37 || keyCode === 34) {
        if (window.app) window.app.playPreviousChannel();
        return;
      }
      if (keyCode === 39 || keyCode === 33) {
        if (window.app) window.app.playNextChannel();
        return;
      }
      return;
    }

    // If Quick Zapper is open, let remoteNav or zapper handle up/down
    if (this.isQuickZapperOpen()) {
      if (keyCode === 37 || key === 'ArrowLeft') {
        this.toggleQuickZapper();
        return;
      }
      return;
    }

    // Standard player controls
    switch (keyCode) {
      case 13: // Enter / OK
        this.togglePlayPause();
        break;
      case 415: // Play
        this.video.play();
        this.revealOSD();
        break;
      case 19: // Pause
        this.video.pause();
        this.revealOSD();
        break;
      case 37: // Left: Previous Channel
      case 34: // Channel Down
        if (window.app) window.app.playPreviousChannel();
        break;
      case 39: // Right: Next Channel
      case 33: // Channel Up
        if (window.app) window.app.playNextChannel();
        break;
      case 38: // Up: Open Quick Zapper
      case 40: // Down: Open Quick Zapper
        this.toggleQuickZapper();
        break;
      default:
        this.revealOSD();
        break;
    }
  }

  exit() {
    this.hideError();
    if (this.isQuickZapperOpen()) {
      this.toggleQuickZapper();
      return;
    }

    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.shaka) {
      this.shaka.unload().catch(() => {});
    }
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    }
    clearTimeout(this.osdTimeout);
    clearTimeout(this.playbackWatchdog);
    this.container.style.display = 'none';

    // Refocus on current channel card
    if (window.app && window.remoteNav) {
      const activeCard = document.querySelector(`.channel-card[data-id="${this.currentChannel?.id}"]`) || document.querySelector('.channel-card');
      if (activeCard) {
        window.remoteNav.setFocus(activeCard);
      }
    }
  }
}

window.VideoPlayer = VideoPlayer;
