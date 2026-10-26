/**
 * OTT Navigator for LG webOS - Electronic Program Guide (EPG) Engine
 */

class EPGEngine {
  constructor() {
    this.programPool = {
      'News & Finance': [
        'Global Markets Open', 'World News Roundup', 'Economic Horizon',
        'Headline Express', 'Tech & Venture Weekly', 'The Evening Brief',
        'Prime Time Analysis', 'Late Night Edition'
      ],
      'Sports & Action': [
        'Championship Highlights', 'Live Action Showcase', 'Extreme Moments',
        'Pre-Match Countdown', 'Motorsport Weekly', 'Inside The Arena',
        'Top 10 Plays of the Month', 'Legends & Champions'
      ],
      'Movies & VOD': [
        'Cinema Premiere Showcase', 'Classic Gold Movie', 'Indie Spotlight',
        'Sci-Fi Feature Presentation', 'Behind The Scenes Special', 'Directors Cut Review',
        'Action Blockbuster Night', 'Midnight Horror Special'
      ],
      'Documentary & Science': [
        'Cosmos: Deep Space Odyssey', 'Wild Planet Earth', 'Future Tech Frontiers',
        'Ocean Giants Underworld', 'Megastructures & Engineering', 'Secrets of the Universe',
        'Wildlife Safari 4K', 'Archaeology Unearthed'
      ],
      'General': [
        'Morning Show Live', 'Midday Infotainment', 'Lifestyle & Travel',
        'Culture Review', 'Prime Time Variety', 'Tonight Live',
        'Overnight Relaxation', 'Daily Digest'
      ]
    };
  }

  /**
   * Generate realistic 24-hour program blocks for a channel
   * @param {Object} channel
   * @returns {Array<Object>}
   */
  generateSchedule(channel) {
    const programs = [];
    const pool = this.programPool[channel.group] || this.programPool['General'];
    const now = new Date();

    // Start 2 hours in the past
    let startTime = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    startTime.setMinutes(startTime.getMinutes() < 30 ? 0 : 30, 0, 0);

    for (let i = 0; i < 8; i++) {
      const durationMin = (i % 2 === 0) ? 60 : 30; // 30m or 60m show
      const endTime = new Date(startTime.getTime() + durationMin * 60 * 1000);

      const title = pool[i % pool.length];
      const isCurrent = now >= startTime && now < endTime;

      let progress = 0;
      if (isCurrent) {
        const elapsed = now.getTime() - startTime.getTime();
        const total = endTime.getTime() - startTime.getTime();
        progress = Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
      }

      programs.push({
        title: title,
        start: new Date(startTime),
        end: new Date(endTime),
        startStr: startTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        endStr: endTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        durationMin: durationMin,
        isCurrent: isCurrent,
        progress: progress
      });

      startTime = new Date(endTime);
    }

    return programs;
  }

  /**
   * Render the full TV Guide EPG Matrix
   * @param {Array<Object>} channels
   * @param {HTMLElement} container
   */
  renderGuideMatrix(channels, container) {
    if (!container) return;
    container.innerHTML = '';

    // Create Time Header
    const timeHeader = document.createElement('div');
    timeHeader.className = 'epg-time-header';

    const now = new Date();
    let slotTime = new Date(now.getTime() - 1 * 60 * 60 * 1000);
    slotTime.setMinutes(slotTime.getMinutes() < 30 ? 0 : 30, 0, 0);

    for (let i = 0; i < 6; i++) {
      const slot = document.createElement('div');
      slot.className = 'epg-time-slot';
      slot.textContent = slotTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      timeHeader.appendChild(slot);
      slotTime = new Date(slotTime.getTime() + 30 * 60 * 1000);
    }
    container.appendChild(timeHeader);

    // Create Channels & Program rows
    const rowsScroll = document.createElement('div');
    rowsScroll.className = 'epg-rows-scroll';

    channels.forEach(ch => {
      const row = document.createElement('div');
      row.className = 'epg-row';

      const chCell = document.createElement('div');
      chCell.className = 'epg-row-channel focusable';
      chCell.tabIndex = 0;
      chCell.innerHTML = `
        <span class="channel-num-badge">${ch.num}</span>
        <span class="channel-name" style="font-size:0.9rem;">${ch.name}</span>
      `;
      chCell.onclick = () => window.player.play(ch);

      const progContainer = document.createElement('div');
      progContainer.className = 'epg-row-programs';

      const schedule = this.generateSchedule(ch);
      schedule.forEach(prog => {
        const progBlock = document.createElement('div');
        progBlock.className = `epg-program-block focusable ${prog.isCurrent ? 'active' : ''}`;
        progBlock.tabIndex = 0;
        progBlock.innerHTML = `
          <div class="epg-program-title">${prog.title}</div>
          <div class="epg-program-time">${prog.startStr} - ${prog.endStr} ${prog.isCurrent ? '• LIVE' : ''}</div>
        `;
        progBlock.onclick = () => window.player.play(ch);
        progContainer.appendChild(progBlock);
      });

      row.appendChild(chCell);
      row.appendChild(progContainer);
      rowsScroll.appendChild(row);
    });

    container.appendChild(rowsScroll);
  }
}

window.EPGEngine = EPGEngine;
