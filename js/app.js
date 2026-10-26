/**
 * OTT Navigator for LG webOS - Main Application Controller
 */

const DEFAULT_PLAYLIST_URL = 'https://la.drmlive.net/tp/playlist.php';
const DEFAULT_USER_AGENT = 'OTT Navigator/1.7.0.2';

class OTTApp {
  constructor() {
    this.channels = [];
    this.filteredChannels = [];
    this.favorites = new Set(JSON.parse(localStorage.getItem('ott_favorites') || '[]'));
    this.activeCategory = 'All';
    this.searchQuery = '';
    this.currentView = 'grid'; // 'grid' | 'epg'

    this.sidebarMode = 'categories'; // 'categories' | 'sources'
    this.activeSource = 'All Sources';
    this.sourceStatuses = {}; // { [sourceName]: { status: 'live'|'down'|'checking', latency: 120, code: 200 } }
    this.isProbingSources = false;

    // DOM Elements
    this.categoryListEl = document.getElementById('category-list');
    this.sidebarTitleEl = document.getElementById('sidebar-title');
    this.channelGridEl = document.getElementById('channel-grid');
    this.epgGuideEl = document.getElementById('epg-guide-container');
    this.activeCategoryTitleEl = document.getElementById('active-category-title');
    this.sourceStatusBadgeEl = document.getElementById('source-status-badge');
    this.btnCheckSourcesEl = document.getElementById('btn-check-sources');
    this.channelStatsEl = document.getElementById('channel-stats');
    this.searchInputEl = document.getElementById('search-input');
    this.playlistModalEl = document.getElementById('playlist-modal');
    this.playlistUrlInput = document.getElementById('playlist-url-input');
    this.fileUploadInput = document.getElementById('file-upload-input');
    this.clockTimeEl = document.getElementById('clock-time');
    this.activePlaylistBadge = document.getElementById('active-playlist-badge');
    this.playlistStatusBar = document.getElementById('playlist-status-bar');
    this.playlistStatusText = document.getElementById('playlist-status-text');

    this.epgEngine = new window.EPGEngine();
  }

  init() {
    this.initClock();
    this.loadInitialChannels();
    this.initSearch();
    this.initModalEvents();

    const savedChannels = localStorage.getItem('ott_saved_channels');

    // Automatically load default playlist on startup if no cached channels, with zero modal prompt!
    if (!savedChannels || !this.channels || this.channels.length === 0) {
      console.log('[OTTApp] Empty cache or first launch - auto-loading default playlist:', DEFAULT_PLAYLIST_URL);
      this.loadPlaylistFromUrl(DEFAULT_PLAYLIST_URL, true);
    } else {
      setTimeout(() => {
        const firstFocusable = document.querySelector('.category-item') || document.querySelector('.channel-card');
        if (firstFocusable && window.remoteNav) {
          window.remoteNav.setFocus(firstFocusable);
        }
      }, 200);
    }
  }

  initClock() {
    const updateTime = () => {
      const now = new Date();
      if (this.clockTimeEl) {
        this.clockTimeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
      if (this.clockDateEl) {
        this.clockDateEl.textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
      }
    };
    updateTime();
    setInterval(updateTime, 1000);
  }

  loadInitialChannels() {
    const saved = localStorage.getItem('ott_saved_channels');
    const savedUrl = localStorage.getItem('ott_playlist_url') || DEFAULT_PLAYLIST_URL;

    if (saved) {
      try {
        this.channels = JSON.parse(saved);
      } catch (e) {
        console.warn('Failed to parse saved channels, will auto-load default playlist.');
        this.channels = [];
      }
    } else {
      this.channels = [];
    }

    // 1. Un-corrupt/restore any event channels that were mistakenly overwritten with Star Sports 1
    const EVENT_RESTORATION = {
      'event 1': 'https://mix.drmlive.net/mix/star-1.m3u8',
      'event 1 hindi': 'https://mix.drmlive.net/mix/star-1.m3u8?audio=hin',
      'event 2': 'https://mix.drmlive.net/mix/star-2.m3u8',
      'event 2 hindi': 'https://mix.drmlive.net/mix/star-2.m3u8?audio=hin',
      'event 3': 'https://mix.drmlive.net/mix/star-3.m3u8',
      'event 3 hindi': 'https://mix.drmlive.net/mix/star-3.m3u8?audio=hin',
      'event 4': 'https://mix.drmlive.net/mix/star-4.m3u8',
      'event 4 hindi': 'https://mix.drmlive.net/mix/star-4.m3u8?audio=hin',
      'event 5': 'https://mix.drmlive.net/mix/star-5.m3u8',
      'event 5 hindi': 'https://mix.drmlive.net/mix/star-5.m3u8?audio=hin',
      'event 6': 'https://mix.drmlive.net/mix/star-6.m3u8',
      'event 6 hindi': 'https://mix.drmlive.net/mix/star-6.m3u8?audio=hin',
    };

    let channelsModified = false;
    if (this.channels && this.channels.length > 0) {
      this.channels.forEach(ch => {
        // Strip cached /proxy?url=
        if (ch.url && (ch.url.startsWith('/proxy') || ch.url.startsWith('proxy'))) {
          const uMatch = ch.url.match(/[?&]url=([^&]+)/);
          if (uMatch) {
            ch.url = decodeURIComponent(uMatch[1]);
            channelsModified = true;
          }
        }
        if (ch.drmKey && (ch.drmKey.startsWith('/proxy') || ch.drmKey.startsWith('proxy'))) {
          const kMatch = ch.drmKey.match(/[?&]url=([^&]+)/);
          if (kMatch) {
            ch.drmKey = decodeURIComponent(kMatch[1]);
            channelsModified = true;
          }
        }

        // Clean pipe delimiters (|Referer=..., |User-Agent=...)
        if (ch.url && ch.url.includes('|')) {
          const parts = ch.url.split('|');
          ch.url = parts[0].trim();
          for (let p = 1; p < parts.length; p++) {
            const part = parts[p].trim();
            if (part.toLowerCase().startsWith('referer=')) {
              ch.referrer = part.substring(8).trim();
            } else if (part.toLowerCase().startsWith('user-agent=')) {
              ch.userAgent = part.substring(11).trim();
            }
          }
          channelsModified = true;
        }

        if (ch.url && ch.url.includes('fancode') && !ch.referrer) {
          ch.referrer = 'https://fancode.com/';
          channelsModified = true;
        } else if (ch.url && (ch.url.includes('suluv') || ch.url.includes('sliv')) && !ch.referrer) {
          ch.referrer = 'https://la.drmlive.net/';
          channelsModified = true;
        }

        const cName = (ch.name || '').toLowerCase().trim();
        if (EVENT_RESTORATION[cName]) {
          ch.url = EVENT_RESTORATION[cName];
          ch.manifestType = 'hls';
          delete ch.drmKey;
          delete ch.drmType;
          channelsModified = true;
        }
      });
    }

    // 2. Auto-migrate and un-corrupt any Star Sports channels in localStorage
    if (this.channels && this.channels.length > 0 && typeof window.resolveStarSports === 'function') {
      this.channels.forEach(ch => {
        const starRes = window.resolveStarSports(ch.name);
        if (starRes) {
          if (ch.url !== starRes.url || ch.drmKey !== starRes.key || ch.drmType !== 'clearkey' || ch.manifestType !== 'dash') {
            ch.url = starRes.url;
            ch.drmKey = starRes.key;
            ch.drmType = 'clearkey';
            ch.manifestType = 'dash';
            ch.referrer = null;
            channelsModified = true;
          }
        }
      });
    }

    // 2b. Auto-migrate Fancode channels to live HLS streams
    if (this.channels && this.channels.length > 0) {
      this.channels.forEach(ch => {
        const cName = (ch.name || '').toLowerCase().trim();
        const cUrl = (ch.url || '').toLowerCase();
        if (cName === 'fancode' || cName === 'fancode 1' || cUrl.includes('sportsfancode.mpd')) {
          ch.url = 'https://mix.drmlive.net/mix/fancode-1.m3u8?category=cricket';
          ch.manifestType = 'hls';
          delete ch.drmKey;
          delete ch.drmType;
          ch.referrer = 'https://fancode.com/';
          channelsModified = true;
        } else if (cName === 'fancode 2' || cUrl.includes('sportsfancode2.mpd')) {
          ch.url = 'https://mix.drmlive.net/mix/fancode-2.m3u8?category=cricket';
          ch.manifestType = 'hls';
          delete ch.drmKey;
          delete ch.drmType;
          ch.referrer = 'https://fancode.com/';
          channelsModified = true;
        }
      });
    }

    // 3. Ensure all channels have up-to-date source metadata attached
    if (this.channels && this.channels.length > 0 && window.M3UParser) {
      this.channels.forEach(ch => {
        const s = window.M3UParser.identifySource(ch.url, ch.name);
        if (ch.source !== s.name || ch.sourceBadge !== s.badge) {
          ch.source = s.name;
          ch.sourceId = s.id;
          ch.sourceBadge = s.badge;
          ch.sourceColor = s.color;
          ch.sourceFormat = s.format;
          channelsModified = true;
        }
      });
    }

    if (channelsModified && saved) {
      localStorage.setItem('ott_saved_channels', JSON.stringify(this.channels));
    }

    if (this.playlistUrlInput) {
      this.playlistUrlInput.value = savedUrl || DEFAULT_PLAYLIST_URL;
    }

    this.updateActiveBadge();
    if (this.channels && this.channels.length > 0) {
      this.renderSidebar();
      this.filterAndRenderChannels();
    }
  }

  updateActiveBadge() {
    if (this.activePlaylistBadge) {
      if (this.channels && this.channels.length > 0) {
        this.activePlaylistBadge.textContent = `Live TV: ${this.channels.length} Channels`;
      } else {
        this.activePlaylistBadge.textContent = 'Live TV: Loading...';
      }
    }
  }

  reloadDefaultPlaylist() {
    this.showToast('Refreshing channels from live playlist...');
    this.loadPlaylistFromUrl(DEFAULT_PLAYLIST_URL);
  }

  renderSidebar() {
    if (this.sidebarMode === 'sources') {
      this.renderSources();
    } else {
      this.renderCategories();
    }
  }

  setSidebarMode(mode) {
    this.sidebarMode = mode;
    const catBtn = document.getElementById('mode-tab-categories');
    const srcBtn = document.getElementById('mode-tab-sources');

    if (mode === 'categories') {
      if (catBtn) catBtn.classList.add('active');
      if (srcBtn) srcBtn.classList.remove('active');
      if (this.sidebarTitleEl) this.sidebarTitleEl.textContent = 'Categories';
      this.renderCategories();
    } else {
      if (srcBtn) srcBtn.classList.add('active');
      if (catBtn) catBtn.classList.remove('active');
      if (this.sidebarTitleEl) this.sidebarTitleEl.textContent = 'Content Sources';
      this.renderSources();
    }

    this.filterAndRenderChannels();
  }

  selectCategory(category) {
    this.activeCategory = category;
    this.renderCategories();
    this.filterAndRenderChannels();
  }

  selectSource(sourceName) {
    this.activeSource = sourceName;
    this.renderSources();
    this.filterAndRenderChannels();
  }

  renderCategories() {
    if (!this.categoryListEl) return;
    this.categoryListEl.innerHTML = '';

    const groups = window.M3UParser.groupCategories(this.channels);

    // 1. Favorites Category
    const favItem = document.createElement('li');
    favItem.className = `category-item focusable ${this.activeCategory === 'Favorites' ? 'active' : ''}`;
    favItem.tabIndex = 0;
    favItem.innerHTML = `
      <div class="category-item-left">
        <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
        <span>Favorites</span>
      </div>
      <span class="category-count">${this.favorites.size}</span>
    `;
    favItem.onclick = () => this.selectCategory('Favorites');
    this.categoryListEl.appendChild(favItem);

    // 2. All Channels
    const allItem = document.createElement('li');
    allItem.className = `category-item focusable ${this.activeCategory === 'All' ? 'active' : ''}`;
    allItem.tabIndex = 0;
    allItem.innerHTML = `
      <div class="category-item-left">
        <svg viewBox="0 0 24 24"><path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/></svg>
        <span>All Channels</span>
      </div>
      <span class="category-count">${this.channels.length}</span>
    `;
    allItem.onclick = () => this.selectCategory('All');
    this.categoryListEl.appendChild(allItem);

    // 3. Extracted Category Groups
    Object.keys(groups).forEach(groupName => {
      if (groupName === 'All') return;

      const item = document.createElement('li');
      item.className = `category-item focusable ${this.activeCategory === groupName ? 'active' : ''}`;
      item.tabIndex = 0;
      item.innerHTML = `
        <div class="category-item-left">
          <svg viewBox="0 0 24 24"><path d="M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z"/></svg>
          <span>${groupName}</span>
        </div>
        <span class="category-count">${groups[groupName]}</span>
      `;
      item.onclick = () => this.selectCategory(groupName);
      this.categoryListEl.appendChild(item);
    });
  }

  renderSources() {
    if (!this.categoryListEl) return;
    this.categoryListEl.innerHTML = '';

    const sources = window.M3UParser.groupSources(this.channels);

    // 1. All Sources Item
    const allItem = document.createElement('li');
    allItem.className = `category-item focusable ${this.activeSource === 'All Sources' ? 'active' : ''}`;
    allItem.tabIndex = 0;
    allItem.innerHTML = `
      <div class="category-item-left">
        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
        <span>All Sources</span>
      </div>
      <span class="category-count">${this.channels.length}</span>
    `;
    allItem.onclick = () => this.selectSource('All Sources');
    this.categoryListEl.appendChild(allItem);

    // 2. Individual Sources
    Object.keys(sources).forEach(sourceName => {
      if (sourceName === 'All Sources') return;

      const count = sources[sourceName];
      const statusObj = this.sourceStatuses[sourceName];
      let statusDotClass = 'untested';
      let statusTitle = 'Untested - click Check Sources Health';

      if (statusObj) {
        if (statusObj.status === 'live') {
          statusDotClass = 'live';
          statusTitle = `Live (${statusObj.latency}ms - 200 OK)`;
        } else if (statusObj.status === 'down') {
          statusDotClass = 'down';
          statusTitle = `Down / Offline (${statusObj.code || 'Timeout'})`;
        } else if (statusObj.status === 'checking') {
          statusDotClass = 'checking';
          statusTitle = 'Checking connectivity...';
        }
      }

      const item = document.createElement('li');
      item.className = `category-item focusable ${this.activeSource === sourceName ? 'active' : ''}`;
      item.tabIndex = 0;
      item.title = `${sourceName}: ${statusTitle}`;
      item.innerHTML = `
        <div class="category-item-left">
          <span class="source-status-dot ${statusDotClass}"></span>
          <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${sourceName}</span>
        </div>
        <span class="category-count">${count}</span>
      `;
      item.onclick = () => this.selectSource(sourceName);
      this.categoryListEl.appendChild(item);
    });
  }

  updateSourceStatusBadge() {
    if (!this.sourceStatusBadgeEl) return;
    if (this.sidebarMode !== 'sources' || this.activeSource === 'All Sources') {
      this.sourceStatusBadgeEl.style.display = 'none';
      return;
    }

    const st = this.sourceStatuses[this.activeSource];
    this.sourceStatusBadgeEl.style.display = 'inline-flex';

    if (!st || st.status === 'untested') {
      this.sourceStatusBadgeEl.className = 'source-status-badge';
      this.sourceStatusBadgeEl.style.background = 'rgba(255,255,255,0.06)';
      this.sourceStatusBadgeEl.style.color = 'var(--text-muted)';
      this.sourceStatusBadgeEl.style.borderColor = 'var(--border-glass)';
      this.sourceStatusBadgeEl.innerHTML = '<span class="source-status-dot untested"></span> Status: Untested';
    } else if (st.status === 'checking') {
      this.sourceStatusBadgeEl.className = 'source-status-badge checking';
      this.sourceStatusBadgeEl.innerHTML = '<span class="source-status-dot checking"></span> Probing Source...';
    } else if (st.status === 'live') {
      this.sourceStatusBadgeEl.className = 'source-status-badge live';
      this.sourceStatusBadgeEl.innerHTML = `<span class="source-status-dot live"></span> Source LIVE (${st.latency}ms - 200 OK)`;
    } else {
      this.sourceStatusBadgeEl.className = 'source-status-badge down';
      this.sourceStatusBadgeEl.innerHTML = '<span class="source-status-dot down"></span> Source Offline / Down';
    }
  }

  async checkSourcesHealth() {
    if (this.isProbingSources) return;
    this.isProbingSources = true;

    if (this.btnCheckSourcesEl) {
      this.btnCheckSourcesEl.classList.add('spinning');
      this.btnCheckSourcesEl.disabled = true;
    }

    this.showToast('Probing all stream sources in real-time...');

    const probes = {
      'JioTV+ (Broadpeak)': 'https://jt.drmlive.net/jiotvplus/1142.mpd',
      'Playbox TV': 'https://mix.drmlive.net/mix/playboxtv-1.m3u8',
      'Xiaomi MiTV': 'https://mix.drmlive.net/mix/xiaomi-1.m3u8',
      'DistroTV': 'https://mix.drmlive.net/mix/distro-1.m3u8',
      'Zee5': 'https://la.drmlive.net/tp/zee5/zeetvhd/index.m3u8',
      'SonyLIV': 'https://la.drmlive.net/tp/sliv-sony.m3u8',
      'Tata Play': 'https://la.drmlive.net/tp/104.mpd',
      'Hotstar / Star': 'https://jt.drmlive.net/jiotvplus/1142.mpd',
      'Live Sports Events': 'https://mix.drmlive.net/mix/fancode-1.m3u8',
      'Direct / Regional FAST': 'https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8'
    };

    const userAgent = localStorage.getItem('ott_user_agent') || 'OTT Navigator/1.7.0.2';

    // Set all to checking state
    Object.keys(probes).forEach(name => {
      this.sourceStatuses[name] = { status: 'checking' };
    });
    this.renderSidebar();
    this.updateSourceStatusBadge();

    let liveCount = 0;
    let downCount = 0;

    const probePromises = Object.entries(probes).map(async ([sourceName, targetUrl]) => {
      const t0 = performance.now();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4500);

      try {
        const proxyUrl = `/proxy?url=${encodeURIComponent(targetUrl)}&ua=${encodeURIComponent(userAgent)}`;
        const res = await fetch(proxyUrl, {
          method: 'GET',
          signal: controller.signal,
          headers: { 'Accept': '*/*' }
        });
        clearTimeout(timeoutId);
        const dt = Math.round(performance.now() - t0);

        if (res.ok) {
          this.sourceStatuses[sourceName] = { status: 'live', latency: dt, code: res.status };
          liveCount++;
        } else {
          this.sourceStatuses[sourceName] = { status: 'down', latency: dt, code: res.status };
          downCount++;
        }
      } catch (err) {
        clearTimeout(timeoutId);
        const dt = Math.round(performance.now() - t0);
        this.sourceStatuses[sourceName] = { status: 'down', latency: dt, error: err.message };
        downCount++;
      }
    });

    await Promise.all(probePromises);

    this.isProbingSources = false;
    if (this.btnCheckSourcesEl) {
      this.btnCheckSourcesEl.classList.remove('spinning');
      this.btnCheckSourcesEl.disabled = false;
    }

    this.renderSidebar();
    this.updateSourceStatusBadge();
    this.showToast(`Health Check Complete: ${liveCount} Sources LIVE, ${downCount} DOWN`);
  }

  initSearch() {
    if (!this.searchInputEl) return;
    this.searchInputEl.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.filterAndRenderChannels();
    });
  }

  filterAndRenderChannels() {
    let list = this.channels;

    if (this.sidebarMode === 'sources') {
      if (this.activeSource !== 'All Sources') {
        list = list.filter(ch => (ch.source || 'Direct / Regional FAST') === this.activeSource);
      }
      if (this.activeCategoryTitleEl) {
        this.activeCategoryTitleEl.textContent = this.activeSource;
      }
      this.updateSourceStatusBadge();
    } else {
      if (this.activeCategory === 'Favorites') {
        list = list.filter(ch => this.favorites.has(ch.id));
      } else if (this.activeCategory !== 'All') {
        list = list.filter(ch => (ch.group || 'General') === this.activeCategory);
      }
      if (this.activeCategoryTitleEl) {
        this.activeCategoryTitleEl.textContent = this.activeCategory;
      }
      if (this.sourceStatusBadgeEl) {
        this.sourceStatusBadgeEl.style.display = 'none';
      }
    }

    if (this.searchQuery) {
      list = list.filter(ch =>
        ch.name.toLowerCase().includes(this.searchQuery) ||
        (ch.group && ch.group.toLowerCase().includes(this.searchQuery)) ||
        (ch.source && ch.source.toLowerCase().includes(this.searchQuery))
      );
    }

    this.filteredChannels = list;

    if (this.channelStatsEl) {
      this.channelStatsEl.textContent = `${list.length} channels available`;
    }

    if (this.currentView === 'grid') {
      this.renderChannelGrid(list);
    } else {
      this.renderEPGGuide(list);
    }
  }

  renderChannelGrid(channels) {
    if (!this.channelGridEl) return;
    this.channelGridEl.innerHTML = '';

    if (channels.length === 0) {
      this.channelGridEl.innerHTML = `
        <div style="grid-column: 1/-1; padding: 60px; text-align: center; color: var(--text-dim);">
          <h3>No channels found</h3>
          <p style="margin-top: 8px;">Try clearing search or importing a new M3U playlist.</p>
        </div>
      `;
      return;
    }

    channels.forEach(ch => {
      const card = document.createElement('div');
      card.className = 'channel-card focusable';
      card.tabIndex = 0;
      card.dataset.id = ch.id;

      const isFav = this.favorites.has(ch.id);

      card.innerHTML = `
        <div class="channel-card-top">
          <div class="channel-logo-wrap">
            ${ch.logo ? `<img class="channel-logo" src="${ch.logo}" alt="${ch.name}" onerror="this.onerror=null;this.parentElement.innerHTML='<span class=\\'channel-logo-fallback\\'>${ch.name.substring(0,2)}</span>'"/>` : `<span class="channel-logo-fallback">${ch.name.substring(0,2)}</span>`}
          </div>
          <div class="channel-meta">
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="channel-num-badge">CH ${ch.num}</span>
              ${ch.sourceBadge ? `<span class="channel-source-pill" style="color: ${ch.sourceColor}; background: ${ch.sourceColor}20; border-color: ${ch.sourceColor}44;" title="${ch.source} (${ch.sourceFormat || ''})">${ch.sourceBadge}</span>` : ''}
            </div>
            <div class="channel-name">${ch.name}</div>
          </div>
          <button class="btn-fav ${isFav ? 'active' : ''}" title="Favorite">
            <svg viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          </button>
        </div>
        <div class="channel-epg">
          <div class="epg-now">
            <span class="live-indicator"></span>
            <span>${ch.epgNow || 'Live Broadcast'}</span>
          </div>
          <div class="epg-progress-bar">
            <div class="epg-progress-fill" style="width: ${ch.progress || 50}%"></div>
          </div>
          <div class="epg-next">Next: ${ch.epgNext || 'Scheduled Program'}</div>
        </div>
      `;

      // Play on card click
      card.onclick = (e) => {
        if (e.target.closest('.btn-fav')) {
          this.toggleFavorite(ch.id);
          return;
        }
        window.player.play(ch);
      };

      this.channelGridEl.appendChild(card);
    });
  }

  renderEPGGuide(channels) {
    if (!this.epgGuideEl) return;
    this.epgEngine.renderGuideMatrix(channels, this.epgGuideEl);
  }

  toggleViewMode() {
    if (this.currentView === 'grid') {
      this.currentView = 'epg';
      document.querySelector('.channel-grid-container').style.display = 'none';
      this.epgGuideEl.style.display = 'flex';
      document.getElementById('tab-epg').classList.add('active');
      document.getElementById('tab-grid').classList.remove('active');
      this.showToast('Switched to TV Guide Matrix');
    } else {
      this.currentView = 'grid';
      document.querySelector('.channel-grid-container').style.display = 'block';
      this.epgGuideEl.style.display = 'none';
      document.getElementById('tab-grid').classList.add('active');
      document.getElementById('tab-epg').classList.remove('active');
      this.showToast('Switched to Channel Grid');
    }
    this.filterAndRenderChannels();
  }

  toggleFavorite(channelId) {
    if (this.favorites.has(channelId)) {
      this.favorites.delete(channelId);
      this.showToast('Removed from Favorites');
    } else {
      this.favorites.add(channelId);
      this.showToast('Added to Favorites');
    }

    localStorage.setItem('ott_favorites', JSON.stringify(Array.from(this.favorites)));
    this.renderCategories();
    this.filterAndRenderChannels();
  }

  toggleCurrentFavorite() {
    if (window.player && window.player.isActive() && window.player.currentChannel) {
      this.toggleFavorite(window.player.currentChannel.id);
    } else if (window.remoteNav && window.remoteNav.currentFocus) {
      const card = window.remoteNav.currentFocus.closest('.channel-card');
      if (card && card.dataset.id) {
        this.toggleFavorite(card.dataset.id);
      }
    }
  }

  playNextChannel() {
    if (!this.filteredChannels.length) return;
    const currentId = window.player.currentChannel?.id;
    let index = this.filteredChannels.findIndex(c => c.id === currentId);
    index = (index + 1) % this.filteredChannels.length;
    window.player.play(this.filteredChannels[index]);
  }

  playPreviousChannel() {
    if (!this.filteredChannels.length) return;
    const currentId = window.player.currentChannel?.id;
    let index = this.filteredChannels.findIndex(c => c.id === currentId);
    index = (index - 1 + this.filteredChannels.length) % this.filteredChannels.length;
    window.player.play(this.filteredChannels[index]);
  }

  renderQuickZapper() {
    const listEl = document.getElementById('quick-channel-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    const currentId = window.player.currentChannel?.id;

    this.filteredChannels.forEach(ch => {
      const item = document.createElement('li');
      item.className = `quick-channel-item focusable ${ch.id === currentId ? 'active' : ''}`;
      item.tabIndex = 0;
      item.innerHTML = `
        <span class="channel-num-badge">${ch.num}</span>
        <span style="font-weight:600; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${ch.name}</span>
      `;
      item.onclick = () => {
        window.player.play(ch);
        window.player.toggleQuickZapper();
      };
      listEl.appendChild(item);
    });
  }

  /* Modal Management */
  openPlaylistModal() {
    if (this.playlistModalEl) {
      this.playlistModalEl.classList.add('open');
      const firstInput = this.playlistModalEl.querySelector('input') || this.playlistModalEl.querySelector('button');
      if (firstInput && window.remoteNav) {
        window.remoteNav.setFocus(firstInput);
      }
    }
  }

  closeModal() {
    if (this.playlistModalEl) {
      this.playlistModalEl.classList.remove('open');
      const btn = document.getElementById('btn-open-playlist');
      if (btn && window.remoteNav) window.remoteNav.setFocus(btn);
    }
  }

  getUserAgent() {
    const customInput = document.getElementById('user-agent-custom-input');
    const select = document.getElementById('user-agent-select');
    if (select && select.value === 'custom' && customInput && customInput.value.trim()) {
      return customInput.value.trim();
    }
    return localStorage.getItem('ott_user_agent') || 'OTT Navigator/1.7.0.2';
  }

  loadPreset(url) {
    if (this.playlistUrlInput) {
      this.playlistUrlInput.value = url;
    }
    this.loadPlaylistFromUrl(url);
  }

  async loadPlaylistFromUrl(url = DEFAULT_PLAYLIST_URL, isSilent = false) {
    if (!url) {
      url = DEFAULT_PLAYLIST_URL;
    }

    const userAgent = this.getUserAgent();
    localStorage.setItem('ott_user_agent', userAgent);

    if (this.channelStatsEl) {
      this.channelStatsEl.textContent = 'Loading live playlist...';
    }

    if (this.playlistStatusBar) {
      this.playlistStatusBar.style.display = 'flex';
      this.playlistStatusText.textContent = `Connecting with User-Agent: ${userAgent}...`;
    }

    if (this.channelGridEl && (!this.channels || this.channels.length === 0)) {
      this.channelGridEl.innerHTML = `
        <div class="channel-loading-banner" style="grid-column: 1/-1; padding: 60px 20px; text-align: center; color: var(--accent-cyan);">
          <div class="spinner" style="width: 44px; height: 44px; border-width: 3px; margin: 0 auto 20px;"></div>
          <h2 style="font-size: 1.3rem; margin-bottom: 8px; color: #fff;">Loading Live Channels...</h2>
          <p style="color: var(--text-dim); font-size: 0.95rem;">Fetching default playlist (${url})</p>
        </div>
      `;
    }

    try {
      const channels = await window.M3UParser.fetchFromUrl(url, (statusMsg) => {
        if (this.playlistStatusText) {
          this.playlistStatusText.textContent = statusMsg;
        }
      }, userAgent);

      this.channels = channels;
      localStorage.setItem('ott_saved_channels', JSON.stringify(channels));
      localStorage.setItem('ott_playlist_url', url);
      this.activeCategory = 'All';
      this.updateActiveBadge();
      this.renderSidebar();
      this.filterAndRenderChannels();

      // Automatically trigger DRMLive IP activation if playlist contains an activation channel
      const activationChannel = channels.find(c => c.name && c.name.toLowerCase().includes('activate playlist'));
      if (activationChannel) {
        console.log('[DRMLive] Auto-activating IP via activation channel...');
        fetch(`/proxy?url=${encodeURIComponent(activationChannel.url)}&ua=${encodeURIComponent(userAgent)}`).catch(() => {});
        if (activationChannel.drmKey && activationChannel.drmKey.startsWith('http')) {
          fetch(`/proxy?url=${encodeURIComponent(activationChannel.drmKey)}&ua=${encodeURIComponent(userAgent)}`).catch(() => {});
        }
      }

      if (this.playlistStatusBar) {
        this.playlistStatusBar.style.display = 'none';
      }
      this.closeModal();
      this.showToast(`Loaded ${channels.length} live channels!`);

      setTimeout(() => {
        const firstFocusable = document.querySelector('.category-item') || document.querySelector('.channel-card');
        if (firstFocusable && window.remoteNav) {
          window.remoteNav.setFocus(firstFocusable);
        }
      }, 200);
    } catch (err) {
      if (this.playlistStatusBar) {
        this.playlistStatusBar.style.display = 'none';
      }
      this.showToast('Error loading playlist: ' + err.message);
      console.error('Playlist load error:', err);
      if (this.channelGridEl && (!this.channels || this.channels.length === 0)) {
        this.channelGridEl.innerHTML = `
          <div style="grid-column: 1/-1; padding: 60px; text-align: center; color: var(--text-dim);">
            <h3 style="color: #ff5252;">Failed to load playlist</h3>
            <p style="margin-top: 8px;">${err.message}</p>
            <button class="btn-primary focusable" style="margin-top: 16px;" onclick="window.app.reloadDefaultPlaylist()">Retry</button>
          </div>
        `;
      }
    }
  }

  initModalEvents() {
    // User-Agent Select setup
    const uaSelect = document.getElementById('user-agent-select');
    const uaCustomInput = document.getElementById('user-agent-custom-input');
    const savedUA = localStorage.getItem('ott_user_agent') || 'OTT Navigator/1.7.0.2';

    if (uaSelect) {
      const existingOption = Array.from(uaSelect.options).find(o => o.value === savedUA);
      if (existingOption) {
        uaSelect.value = savedUA;
      } else {
        uaSelect.value = 'custom';
        if (uaCustomInput) {
          uaCustomInput.style.display = 'block';
          uaCustomInput.value = savedUA;
        }
      }

      uaSelect.addEventListener('change', (e) => {
        if (e.target.value === 'custom') {
          if (uaCustomInput) {
            uaCustomInput.style.display = 'block';
            if (window.remoteNav) window.remoteNav.setFocus(uaCustomInput);
          }
        } else {
          if (uaCustomInput) uaCustomInput.style.display = 'none';
          localStorage.setItem('ott_user_agent', e.target.value);
        }
      });
    }

    if (uaCustomInput) {
      uaCustomInput.addEventListener('input', (e) => {
        if (e.target.value.trim()) {
          localStorage.setItem('ott_user_agent', e.target.value.trim());
        }
      });
    }

    // Load via URL
    const btnLoadUrl = document.getElementById('btn-load-url');
    if (btnLoadUrl) {
      btnLoadUrl.onclick = () => {
        const url = this.playlistUrlInput.value.trim();
        this.loadPlaylistFromUrl(url);
      };
    }

    // Load via File Upload
    if (this.fileUploadInput) {
      this.fileUploadInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (this.playlistStatusBar) {
          this.playlistStatusBar.style.display = 'flex';
          this.playlistStatusText.textContent = `Reading ${file.name}...`;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const parsed = window.M3UParser.parse(event.target.result);
            if (!parsed.length) throw new Error('No valid streams in file');
            this.channels = parsed;
            localStorage.setItem('ott_saved_channels', JSON.stringify(parsed));
            localStorage.setItem('ott_playlist_url', `file://${file.name}`);
            this.activeCategory = 'All';
            this.updateActiveBadge();
            this.renderCategories();
            this.filterAndRenderChannels();
            if (this.playlistStatusBar) {
              this.playlistStatusBar.style.display = 'none';
            }
            this.closeModal();
            this.showToast(`Loaded ${parsed.length} channels from local file!`);
          } catch (err) {
            if (this.playlistStatusBar) {
              this.playlistStatusBar.style.display = 'none';
            }
            this.showToast('Error parsing file: ' + err.message);
          }
        };
        reader.readAsText(file);
      });
    }

    // Reset to Demo Channels
    const btnResetDemo = document.getElementById('btn-reset-demo');
    if (btnResetDemo) {
      btnResetDemo.onclick = () => {
        this.channels = window.DEFAULT_CHANNELS;
        localStorage.removeItem('ott_saved_channels');
        localStorage.removeItem('ott_playlist_url');
        this.activeCategory = 'All';
        this.updateActiveBadge();
        this.renderCategories();
        this.filterAndRenderChannels();
        if (this.playlistStatusBar) {
          this.playlistStatusBar.style.display = 'none';
        }
        this.closeModal();
        this.showToast('Using Default Free HD Demo Channels');
      };
    }
  }

  showToast(message) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#00f2fe"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>
      <span>${message}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.remoteNav = new window.RemoteNav();
  window.player = new window.VideoPlayer();
  window.app = new OTTApp();
  window.app.init();
});
