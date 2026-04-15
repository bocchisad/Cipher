// ==================== PROFILE FEATURES ====================
// Функции для работы с профилем: bio, треки, прикрепленный канал

// ====== UTILITIES ======
function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ====== PROFILE TRACKS ======
function refreshSettingsTracksList() {
  const list = document.getElementById('settingsTracksList');
  if (!list) return;
  const tracks = myProfile.tracks || [];
  if (tracks.length === 0) {
    list.innerHTML = '<div style="color:var(--text2);font-size:13px;text-align:center;padding:12px">Нет добавленных треков</div>';
    return;
  }
  list.innerHTML = '';
  tracks.forEach((track, idx) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--bg3);border-radius:8px;border:1px solid var(--border)';
    row.innerHTML = `
      <div style="width:32px;height:32px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;flex-shrink:0;color:#fff">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(track.title || 'Без названия')}</div>
        <div style="font-size:11px;color:var(--text2)">${escapeHtml(track.artist || '')}</div>
      </div>
      <button type="button" class="icon-btn" data-idx="${idx}" style="width:28px;height:28px;flex-shrink:0" title="Удалить">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    `;
    row.querySelector('button').onclick = () => removeProfileTrack(idx);
    list.appendChild(row);
  });
}

function removeProfileTrack(idx) {
  if (!myProfile.tracks) return;
  myProfile.tracks.splice(idx, 1);
  refreshSettingsTracksList();
}

// ====== PROFILE TRACKS (MOBILE) ======
// generateSecureId is declared in index.html
async function addProfileTrackMobile(file) {
  if (!file || !file.type.startsWith('audio/')) return;
  
  const dataUrl = await fileToBase64(file);
  const track = {
    id: Date.now() + '_' + generateSecureId(8),  // ✅ SECURE RANDOM ID
    title: file.name.replace(/\.[^/.]+$/, ''),
    artist: '',
    dataUrl: dataUrl,
    size: file.size,
    addedAt: Date.now()
  };
  
  if (!myProfile.tracks) myProfile.tracks = [];
  myProfile.tracks.push(track);
  refreshSettingsTracksList();
}

async function addProfileTrack(file) {
  if (!file || !file.type.startsWith('audio/')) return;
  
  const dataUrl = await fileToBase64(file);
  const track = {
    id: Date.now() + '_' + generateSecureId(8),  // ✅ SECURE RANDOM ID
    title: file.name.replace(/\.[^/.]+$/, ''),
    artist: '',
    dataUrl: dataUrl,
    size: file.size,
    addedAt: Date.now()
  };
  
  if (!myProfile.tracks) myProfile.tracks = [];
  myProfile.tracks.push(track);
  refreshSettingsTracksList();
}

// ====== PROFILE ATTACHED CHANNEL ======
function refreshSettingsAttachedChannel() {
  const attachedDiv = document.getElementById('settingsAttachedChannel');
  const noAttachedDiv = document.getElementById('settingsNoAttachedChannel');
  const select = document.getElementById('settingsChannelSelect');
  const attachBtn = document.getElementById('settingsAttachChannelBtn');
  
  const meN = normUid(myProfile.uuid);
  const ownedChannels = contacts.filter(c => c.kind === 'channel' && c.roomOwner && normUid(c.roomOwner) === meN);
  
  if (select) {
    select.innerHTML = '<option value="">Выберите канал...</option>';
    ownedChannels.forEach(ch => {
      const opt = document.createElement('option');
      opt.value = ch.uuid;
      opt.textContent = ch.nickname || ch.username || ch.uuid.slice(0, 12);
      select.appendChild(opt);
    });
  }
  
  const attachedId = myProfile.attachedChannelId;
  if (attachedId && attachedDiv && noAttachedDiv) {
    const ch = contacts.find(c => normUid(c.uuid) === normUid(attachedId));
    if (ch) {
      attachedDiv.style.display = 'block';
      noAttachedDiv.style.display = 'none';
      const avPh = document.getElementById('settingsAttachedChannelAv');
      const nameEl = document.getElementById('settingsAttachedChannelName');
      if (avPh) renderAvatar(avPh, ch.avatar, ch.nickname || ch.username);
      if (nameEl) nameEl.textContent = ch.nickname || ch.username || ch.uuid.slice(0, 12);
    } else {
      attachedDiv.style.display = 'none';
      noAttachedDiv.style.display = 'block';
    }
    if (attachBtn) {
      attachBtn.style.display = 'none';
      if (select) select.style.display = 'none';
    }
  } else {
    if (attachedDiv) attachedDiv.style.display = 'none';
    if (noAttachedDiv) noAttachedDiv.style.display = 'block';
    // Always show the button, let click handler deal with "no channels" case
    if (attachBtn) {
      attachBtn.style.display = 'flex';
      if (select) select.style.display = 'none';
    }
  }
}

function detachProfileChannel() {
  delete myProfile.attachedChannelId;
  refreshSettingsAttachedChannel();
}

// ====== MINI PROFILE ENHANCED ======
// miniProfileTargetUuid, currentMiniProfileTrackIndex, miniProfileTracksQueue declared in index.html

function bindMiniProfileAvatar(el, userUuid) {
  if (!el || !userUuid) return;
  const u = normUid(userUuid);
  el.classList.add('clickable-user-av');
  el.onclick = (e) => {
    e.stopPropagation();
    openMiniUserProfileEnhanced(u);
  };
}

function openMiniUserProfileEnhanced(userUuid) {
  wireMiniUserProfileModalOnce();
  const u = normUid(userUuid);
  if (!u) return;
  miniProfileTargetUuid = u;
  
  const c = contacts.find(x => normUid(x.uuid) === u);
  const isMyProfile = u === normUid(myProfile.uuid);
  const profile = isMyProfile ? myProfile : (c || {});
  
  const nick = profile.nickname || u.slice(0, 12);
  const av = profile.avatar || '';
  const bio = profile.bio || '';
  const tracks = profile.tracks || [];
  const attachedChannelId = profile.attachedChannelId;
  
  // Avatar
  const avEl = document.getElementById('miniProfileAv');
  if (avEl) {
    avEl.innerHTML = '';
    renderAvatar(avEl, av, nick);
  }
  
  // Nickname
  const nickEl = document.getElementById('miniProfileNick');
  if (nickEl) nickEl.textContent = nick;
  
  // Status
  const statusEl = document.getElementById('miniProfileStatus');
  if (statusEl) {
    if (isMyProfile) {
      statusEl.textContent = 'online';
    } else {
      const isOnline = c?.online || false;
      statusEl.textContent = isOnline ? 'online' : 'offline';
    }
  }
  
  // UUID
  const idEl = document.getElementById('miniProfileId');
  if (idEl) idEl.textContent = u;
  
  // Bio
  const bioEl = document.getElementById('miniProfileBio');
  if (bioEl) {
    if (bio.trim()) {
      bioEl.textContent = bio;
      bioEl.style.display = 'block';
    } else {
      bioEl.style.display = 'none';
    }
  }
  
  // Attached channel
  const attachedChEl = document.getElementById('miniProfileAttachedChannel');
  const channelAvEl = document.getElementById('miniProfileChannelAv');
  const channelNameEl = document.getElementById('miniProfileChannelName');
  const addChannelEl = document.getElementById('miniProfileAddChannel');
  const addChannelBtn = document.getElementById('miniProfileAddChannelBtn');

  if (attachedChEl && attachedChannelId) {
    const ch = contacts.find(x => normUid(x.uuid) === normUid(attachedChannelId) && x.kind === 'channel');
    if (ch) {
      attachedChEl.style.display = 'block';
      if (addChannelEl) addChannelEl.style.display = 'none';
      if (channelAvEl) {
        channelAvEl.innerHTML = '';
        renderAvatar(channelAvEl, ch.avatar, ch.nickname || ch.username);
      }
      if (channelNameEl) channelNameEl.textContent = ch.nickname || ch.username || 'Канал';
      attachedChEl.onclick = () => {
        closeMiniProfileModalEnhanced();
        openChat(ch.uuid);
      };
    } else {
      attachedChEl.style.display = 'none';
      // Show "Add Channel" button if it's my profile
      if (isMyProfile && addChannelEl) {
        addChannelEl.style.display = 'block';
        if (addChannelBtn) {
          addChannelBtn.onclick = () => {
            closeMiniProfileModalEnhanced();
            openSettings();
            // Switch to channel select in settings
            setTimeout(() => {
              const channelSelect = document.getElementById('settingsChannelSelect');
              if (channelSelect) channelSelect.focus();
            }, 100);
          };
        }
      } else if (addChannelEl) {
        addChannelEl.style.display = 'none';
      }
    }
  } else if (attachedChEl) {
    attachedChEl.style.display = 'none';
    // Show "Add Channel" button if it's my profile and no channel attached
    if (isMyProfile && addChannelEl) {
      addChannelEl.style.display = 'block';
      if (addChannelBtn) {
        addChannelBtn.onclick = () => {
          closeMiniProfileModalEnhanced();
          openSettings();
          // Switch to channel select in settings
          setTimeout(() => {
            const channelSelect = document.getElementById('settingsChannelSelect');
            if (channelSelect) channelSelect.focus();
          }, 100);
        };
      }
    } else if (addChannelEl) {
      addChannelEl.style.display = 'none';
    }
  }
  
  // Tracks playlist
  const tracksEl = document.getElementById('miniProfileTracks');
  const tracksListEl = document.getElementById('miniProfileTracksList');
  if (tracksEl && tracksListEl) {
    if (tracks.length > 0) {
      tracksEl.style.display = 'block';
      tracksListEl.innerHTML = '';
      tracks.forEach((track, idx) => {
        const row = document.createElement('div');
        row.className = 'mini-profile-track-item';
        row.innerHTML = `
          <div class="mini-profile-track-play">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
          <div class="mini-profile-track-info">
            <div class="mini-profile-track-title">${escapeHtml(track.title || 'Без названия')}</div>
            <div class="mini-profile-track-artist">${escapeHtml(track.artist || '')}</div>
          </div>
        `;
        row.onclick = () => playMiniProfileTrack(track, idx, tracks);
        tracksListEl.appendChild(row);
      });
    } else {
      tracksEl.style.display = 'none';
    }
  }
  
  // Write button
  const writeBtn = document.getElementById('miniProfileWriteBtn');
  if (writeBtn) {
    writeBtn.style.display = isMyProfile ? 'none' : 'flex';
    writeBtn.style.width = '100%';
  }
  
  // Show modal with animation
  const modal = document.getElementById('miniUserProfileModal');
  const panel = modal?.querySelector('.mini-profile-modal');
  if (modal) {
    modal.style.display = 'flex';
    requestAnimationFrame(() => {
      modal.style.opacity = '1';
      if (panel) panel.classList.add('show');
    });
  }
  
  if (ws && ws.readyState === WebSocket.OPEN && !isMyProfile) {
    sendToServer('request-profile', { uuid: u });
  }
}

function closeMiniProfileModalEnhanced() {
  const modal = document.getElementById('miniUserProfileModal');
  const panel = modal?.querySelector('.mini-profile-modal');
  if (modal) {
    modal.style.opacity = '0';
    if (panel) panel.classList.remove('show');
    setTimeout(() => {
      modal.style.display = 'none';
    }, 200);
  }
}

function playMiniProfileTrack(track, index, allTracks) {
  if (!track?.dataUrl) return;
  currentMiniProfileTrackIndex = index;
  miniProfileTracksQueue = allTracks;
  
  // Use global audio player if available
  if (typeof loadAndPlayGlobalAudio === 'function') {
    // Build playlist for global audio player
    const playlist = allTracks.map((t, i) => ({
      url: t.dataUrl,
      title: t.title || 'Без названия',
      from: miniProfileTargetUuid,
      ts: t.addedAt || Date.now(),
      type: 'track'
    }));
    
    // Set global playlist and index
    window.globalAudioPlaylist = playlist;
    window.globalAudioIndex = index;
    
    // Load and play the track
    loadAndPlayGlobalAudio(playlist[index]);
    showToast(`▶ ${track.title || 'Трек'}`);
  } else if (window.audioPlayer && window.audioPlayer.show) {
    // Use existing audio player
    window.audioPlayer.show(track.dataUrl, track.title || 'Без названия', miniProfileTargetUuid, track.addedAt || Date.now());
  } else {
    // Fallback - create temporary audio with controls
    let audio = window._miniProfileAudio;
    if (audio && !audio.paused && audio.src === track.dataUrl) {
      audio.pause();
      showToast(`⏸ ${track.title || 'Трек'}`);
      return;
    }
    if (audio) audio.pause();
    audio = new Audio(track.dataUrl);
    window._miniProfileAudio = audio;
    audio.play().then(() => {
      showToast(`▶ ${track.title || 'Трек'}`);
    }).catch(() => showToast('Не удалось воспроизвести'));
  }
}

function wireMiniUserProfileModalOnce() {
  if (window._miniProfWired) return;
  window._miniProfWired = true;
  
  // Initialize player sync for mini profile
  setTimeout(() => {
    if (typeof initMiniProfilePlayerSync === 'function') {
      initMiniProfilePlayerSync();
    }
  }, 1000); // Wait for global audio player to be initialized
  
  const modal = document.getElementById('miniUserProfileModal');
  const closeBtn = document.getElementById('miniProfileCloseBtn');
  const writeBtn = document.getElementById('miniProfileWriteBtn');
  const idEl = document.getElementById('miniProfileId');
  
  if (modal) {
    modal.onclick = (e) => {
      if (e.target === modal) closeMiniProfileModalEnhanced();
    };
  }
  if (closeBtn) {
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      closeMiniProfileModalEnhanced();
    };
  }
  if (writeBtn) {
    writeBtn.onclick = (e) => {
      e.stopPropagation();
      closeMiniProfileModalEnhanced();
      if (miniProfileTargetUuid) openMiniUserProfileWrite(miniProfileTargetUuid);
    };
  }
  if (idEl) {
    idEl.onclick = async () => {
      const ok = await copyTextSafe(idEl.textContent);
      showToast(ok ? 'UUID скопирован!' : 'Не удалось скопировать');
    };
  }
}

async function openMiniUserProfileWrite(uuid) {
  const u = normUid(uuid);
  if (u === normUid(myProfile.uuid)) {
    showToast('Это вы');
    return;
  }
  let c = contacts.find(x => normUid(x.uuid) === u);
  if (!c) {
    c = {
      uuid: u,
      nickname: u.slice(0, 12),
      avatar: '',
      online: false,
      lastMsg: '',
      lastTs: 0,
      unread: 0,
      type: 'friend',
      kind: 'friend'
    };
    contacts.push(c);
    const cleaned = sanitizeContact(c);
    if (cleaned) await dbPut('contacts', cleaned);
    renderSidebar();
  }
  await openChat(u);
}
