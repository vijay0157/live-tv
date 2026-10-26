/**
 * OTT Navigator for LG webOS - Remote Control & Spatial Navigation Engine
 */

class RemoteNav {
  constructor() {
    this.currentFocus = null;
    this.historyStack = [];
    this.initKeyListeners();
  }

  initKeyListeners() {
    window.addEventListener('keydown', (e) => this.handleKeyDown(e));

    // Handle mouse/pointer hover for LG Magic Remote pointer
    document.addEventListener('mouseover', (e) => {
      const focusable = e.target.closest('.focusable');
      if (focusable && focusable !== this.currentFocus) {
        this.setFocus(focusable, false);
      }
    });
  }

  /**
   * Set visual and keyboard focus
   * @param {HTMLElement} el
   * @param {boolean} scrollIntoView
   */
  setFocus(el, scrollIntoView = true) {
    if (!el) return;
    if (this.currentFocus) {
      this.currentFocus.classList.remove('focused');
    }
    this.currentFocus = el;
    this.currentFocus.classList.add('focused');

    if (scrollIntoView) {
      this.currentFocus.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest'
      });
    }

    if (typeof el.focus === 'function' && el.tagName === 'INPUT') {
      el.focus();
    }
  }

  getCurrentFocus() {
    return this.currentFocus;
  }

  handleKeyDown(e) {
    const keyCode = e.keyCode;
    const key = e.key;

    // webOS Keycodes
    // 37: Left, 38: Up, 39: Right, 40: Down, 13: Enter
    // 461: webOS Back Key, 27: Escape
    // 403: Red, 404: Green, 405: Yellow, 406: Blue
    // 415: Play, 19: Pause, 413: Stop, 33: ChUp, 34: ChDown

    const isBack = keyCode === 461 || keyCode === 27 || key === 'Escape';
    const isEnter = keyCode === 13 || key === 'Enter';
    const isLeft = keyCode === 37 || key === 'ArrowLeft';
    const isUp = keyCode === 38 || key === 'ArrowUp';
    const isRight = keyCode === 39 || key === 'ArrowRight';
    const isDown = keyCode === 40 || key === 'ArrowDown';

    // If user is typing in an input or textarea, DO NOT intercept normal typing keys!
    const isTyping = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');

    if (isTyping) {
      // In text input, allow normal typing of letters (including r, g, y, b, space, numbers)
      // and allow ArrowLeft/ArrowRight to move the text cursor
      if (isEnter) {
        // If Enter is pressed inside the playlist input, trigger the load button
        if (document.activeElement.id === 'playlist-url-input') {
          e.preventDefault();
          const loadBtn = document.getElementById('btn-load-url');
          if (loadBtn) loadBtn.click();
          return;
        } else if (document.activeElement.id === 'search-input') {
          // If Enter in search input, move focus down to first channel
          e.preventDefault();
          const firstCard = document.querySelector('.channel-card');
          if (firstCard) this.setFocus(firstCard);
          return;
        }
      }

      if (isBack) {
        e.preventDefault();
        document.activeElement.blur();
        const activeModal = document.querySelector('.modal-overlay.open');
        if (activeModal && window.app) {
          window.app.closeModal();
        }
        return;
      }

      // Allow ArrowUp / ArrowDown to move to other buttons inside modal
      if (isUp || isDown) {
        const activeModal = document.querySelector('.modal-overlay.open');
        if (activeModal) {
          e.preventDefault();
          this.handleModalNavigation(activeModal, isUp, isDown, false, false, false);
          return;
        }
      }

      // Let all other keys (letters, numbers, left, right, delete, backspace) pass through to the input!
      return;
    }

    // Color buttons shortcuts (only when NOT typing in an input field)
    if (isRed && window.app) {
      e.preventDefault();
      window.app.toggleCurrentFavorite();
      return;
    }
    if (isGreen && window.app) {
      e.preventDefault();
      window.app.toggleViewMode();
      return;
    }
    if (isYellow && window.app) {
      e.preventDefault();
      window.app.reloadDefaultPlaylist();
      return;
    }
    if (isBlue && window.player) {
      e.preventDefault();
      window.player.cycleAspectRatio();
      return;
    }

    // Modal Active Handling (when focus is on buttons inside modal)
    const activeModal = document.querySelector('.modal-overlay.open');
    if (activeModal) {
      if (isBack) {
        e.preventDefault();
        window.app.closeModal();
        return;
      }
      this.handleModalNavigation(activeModal, isUp, isDown, isLeft, isRight, isEnter);
      return;
    }

    // Fullscreen Player Active Handling
    if (window.player && window.player.isActive()) {
      if (isBack) {
        e.preventDefault();
        window.player.exit();
        return;
      }
      window.player.handleRemoteInput(keyCode, key);
      return;
    }

    // Main App Navigation
    if (isBack) {
      // If we are in channel grid, return focus to sidebar
      const inGrid = this.currentFocus && this.currentFocus.closest('.channel-grid');
      if (inGrid) {
        e.preventDefault();
        const activeCategory = document.querySelector('.category-item.active') || document.querySelector('.category-item');
        if (activeCategory) this.setFocus(activeCategory);
        return;
      }
      // Otherwise default webOS action
      return;
    }

    if (isEnter) {
      if (this.currentFocus) {
        e.preventDefault();
        this.currentFocus.click();
      }
      return;
    }

    if (isUp || isDown || isLeft || isRight) {
      e.preventDefault();
      this.navigateSpatial(isUp, isDown, isLeft, isRight);
    }
  }

  handleModalNavigation(modal, isUp, isDown, isLeft, isRight, isEnter) {
    const focusables = Array.from(modal.querySelectorAll('.focusable'));
    if (!focusables.length) return;

    let index = focusables.indexOf(this.currentFocus);
    if (index === -1) {
      this.setFocus(focusables[0]);
      return;
    }

    if (isDown || isRight) {
      index = (index + 1) % focusables.length;
      this.setFocus(focusables[index]);
    } else if (isUp || isLeft) {
      index = (index - 1 + focusables.length) % focusables.length;
      this.setFocus(focusables[index]);
    } else if (isEnter && this.currentFocus) {
      this.currentFocus.click();
    }
  }

  navigateSpatial(isUp, isDown, isLeft, isRight) {
    const focusables = Array.from(document.querySelectorAll('.focusable')).filter(el => {
      // Must be visible
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !el.closest('.modal-overlay:not(.open)') && !el.closest('#player-container:not([style*="display: block"])');
    });

    if (!focusables.length) return;

    if (!this.currentFocus || !focusables.includes(this.currentFocus)) {
      this.setFocus(focusables[0]);
      return;
    }

    const currentRect = this.currentFocus.getBoundingClientRect();
    const currentCenter = {
      x: currentRect.left + currentRect.width / 2,
      y: currentRect.top + currentRect.height / 2
    };

    let bestCandidate = null;
    let minDistance = Infinity;

    for (const el of focusables) {
      if (el === this.currentFocus) continue;

      const rect = el.getBoundingClientRect();
      const center = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };

      const dx = center.x - currentCenter.x;
      const dy = center.y - currentCenter.y;

      let isDirectionValid = false;

      if (isRight && dx > 15 && Math.abs(dy) <= Math.abs(dx) * 1.5) {
        isDirectionValid = true;
      } else if (isLeft && dx < -15 && Math.abs(dy) <= Math.abs(dx) * 1.5) {
        isDirectionValid = true;
      } else if (isDown && dy > 15 && Math.abs(dx) <= Math.abs(dy) * 1.5) {
        isDirectionValid = true;
      } else if (isUp && dy < -15 && Math.abs(dx) <= Math.abs(dy) * 1.5) {
        isDirectionValid = true;
      }

      if (isDirectionValid) {
        // Weighted euclidean distance (favor the primary direction axis)
        const primaryWeight = 1.0;
        const secondaryWeight = 2.2;
        const dist = (isRight || isLeft)
          ? Math.sqrt(Math.pow(dx * primaryWeight, 2) + Math.pow(dy * secondaryWeight, 2))
          : Math.sqrt(Math.pow(dx * secondaryWeight, 2) + Math.pow(dy * primaryWeight, 2));

        if (dist < minDistance) {
          minDistance = dist;
          bestCandidate = el;
        }
      }
    }

    if (bestCandidate) {
      this.setFocus(bestCandidate);
    }
  }
}

window.RemoteNav = RemoteNav;
