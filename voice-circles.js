// ==================== VOICE CIRCLES (TELEGRAM-STYLE) WITH E2EE ====================
// Система голосовых кружочков с паузами, отменой, переключением голос/кружок
// ✅ Все кружочки и голос сообщения ЗАШИФРОВАНЫ (E2EE)

const VoiceCirclesModule = (() => {
  let circleMode = false; // false = голос сообщение, true = кружочек
  let isRecordingCircle = false;
  let waveformInterval = null;
  let mediaRecorder = null;
  let audioContext = null;
  let analyser = null;
  let currentFacingMode = 'user'; // 'user' = фронтальная, 'environment' = задняя
  let videoStream = null; // текущий видеопоток для переключения камеры

  const MIC_ICON = `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M19 10a7 7 0 01-14 0M12 19v3M8 22h8"/></svg>`;
  const CAMERA_ICON = `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`;
  
  // Иконка переключения камеры
  const FLIP_CAMERA_ICON_SVG = `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5l2-3h6l2 3h5a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-7"/><path d="M20 16v-4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v4"/><path d="M16 16l-4-4"/><path d="M16 16l4-4"/></svg>`;

  // SVG иконки для замены эмодзи
  const LOCK_ICON_SVG = `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
  const UNLOCK_ICON_SVG = `<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.2 1"/></svg>`;
  const PLAY_ICON_SVG = `<svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
  const PAUSE_ICON_SVG = `<svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`;

  function init() {
    const recordBtn = document.getElementById('recordBtn');
    if (recordBtn) {
      recordBtn.innerHTML = MIC_ICON;
      recordBtn.style.color = 'var(--accent)';
      recordBtn.style.transform = 'scale(1) rotate(0deg)';
      recordBtn.style.opacity = '1';
      recordBtn.title = 'Голос (нажмите для кружков)';
    }
    const indicator = document.getElementById('voiceModeIndicator');
    if (indicator) {
      indicator.innerHTML = `<svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24" style="display:inline-block;margin-right:6px;vertical-align:middle;"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M19 10a7 7 0 01-14 0M12 19v3M8 22h8"/></svg>ГОЛОС`;
      indicator.style.color = 'var(--accent)';
    }
  }

  // Обновление иконки кнопки с плавной анимацией
  function updateButtonIcon(btn, isCircleMode) {
    // Анимация исчезновения
    btn.style.transform = 'scale(0.8) rotate(-90deg)';
    btn.style.opacity = '0.5';
    
    setTimeout(() => {
      // Меняем иконку
      btn.innerHTML = isCircleMode ? CAMERA_ICON : MIC_ICON;
      btn.style.color = isCircleMode ? '#e74c3c' : 'var(--accent)';
      btn.title = isCircleMode ? 'Видео кружки (нажмите для голоса)' : 'Голос (нажмите для кружков)';
      
      // Анимация появления
      btn.style.transform = 'scale(1.15) rotate(0deg)';
      btn.style.opacity = '1';
      
      setTimeout(() => {
        btn.style.transform = 'scale(1) rotate(0deg)';
      }, 200);
    }, 150);
    
    // Устанавливаем CSS transition для плавности
    btn.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s, color 0.3s';
  }

  // Переключение между голос сообщением и кружочком
  function toggleCircleMode() {
    circleMode = !circleMode;
    const recordBtn = document.getElementById('recordBtn');
    const indicator = document.getElementById('voiceModeIndicator');
    const overlayStatus = document.getElementById('voiceRecOverlayStatus');
    
    // Обновляем иконку кнопки с анимацией
    if (recordBtn) {
      updateButtonIcon(recordBtn, circleMode);
    }

    // Обновить индикатор режима в оверлее
    if (indicator) {
      indicator.style.transition = 'all 0.3s ease';
      if (circleMode) {
        indicator.innerHTML = `<svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24" style="display:inline-block;margin-right:6px;vertical-align:middle;"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>ВИДЕО`;
        indicator.style.color = '#e74c3c';
      } else {
        indicator.innerHTML = `<svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24" style="display:inline-block;margin-right:6px;vertical-align:middle;"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M19 10a7 7 0 01-14 0M12 19v3M8 22h8"/></svg>ГОЛОС`;
        indicator.style.color = 'var(--accent)';
      }
    }

    // Обновляем статус в оверлее
    if (overlayStatus) {
      overlayStatus.textContent = circleMode ? 'Видео кружок…' : 'Запись голоса…';
    }

    // Показываем toast
    showToast(circleMode ? 'Режим видео-кружков' : 'Режим голосовых сообщений', { duration: 1500 });
  }

  // Получить текущий режим
  function getCircleMode() {
    return circleMode;
  }

  // ==================== WAVEFORM ВИЗУАЛИЗАЦИЯ ====================
  // Создать и запустить визуализацию waveform для голосовых сообщений
  function startWaveformVisualization(stream) {
    try {
      // Создаем аудио контекст
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.8;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      // Создаем canvas для waveform
      createWaveformCanvas();
      
      const canvas = document.getElementById('waveformCanvas');
      if (!canvas) return;

      const ctx = canvas.getContext('2d');
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      function drawWaveform() {
        if (!voiceSession || voiceSession.paused) {
          waveformInterval = requestAnimationFrame(drawWaveform);
          return;
        }

        analyser.getByteFrequencyData(dataArray);

        // Очищаем canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Рисуем waveform
        const bars = 20;
        const barWidth = canvas.width / bars;
        const gap = 2;
        const centerY = canvas.height / 2;

        for (let i = 0; i < bars; i++) {
          const dataIndex = Math.floor(i * (bufferLength / bars));
          const value = dataArray[dataIndex];
          const percent = value / 255;
          const barHeight = percent * canvas.height * 0.8;

          const x = i * barWidth + gap / 2;
          const y = centerY - barHeight / 2;

          // Градиент
          const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
          gradient.addColorStop(0, 'var(--accent)');
          gradient.addColorStop(1, 'rgba(79, 142, 247, 0.3)');

          ctx.fillStyle = gradient;
          ctx.roundRect(x, y, barWidth - gap, barHeight, 4);
          ctx.fill();
        }

        waveformInterval = requestAnimationFrame(drawWaveform);
      }

      drawWaveform();
    } catch (err) {
      console.warn('Waveform visualization error:', err);
    }
  }

  // Создать canvas для waveform
  function createWaveformCanvas() {
    let canvas = document.getElementById('waveformCanvas');
    if (canvas) canvas.remove();

    canvas = document.createElement('canvas');
    canvas.id = 'waveformCanvas';
    canvas.width = 300;
    canvas.height = 80;
    canvas.style.cssText = `
      position: absolute;
      bottom: 200px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10000;
      pointer-events: none;
    `;

    const overlay = document.getElementById('voiceRecordingOverlay');
    if (overlay) {
      overlay.appendChild(canvas);
    }
  }

  // Остановить waveform
  function stopWaveformVisualization() {
    if (waveformInterval) {
      cancelAnimationFrame(waveformInterval);
      waveformInterval = null;
    }
    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
    analyser = null;
    
    const canvas = document.getElementById('waveformCanvas');
    if (canvas) canvas.remove();
  }

  // ==================== КРУГОВАЯ ШКАЛА ДЛЯ ВИДЕОКРУЖКОВ ====================
  // Создать круговой прогресс бар вокруг видео (только кольцо, не закрывает центр)
  function createCircularProgress() {
    let progress = document.getElementById('circleVideoProgress');
    if (progress) progress.remove();

    progress = document.createElement('div');
    progress.id = 'circleVideoProgress';
    progress.style.cssText = `
      position: absolute;
      top: -8px;
      left: -8px;
      right: -8px;
      bottom: -8px;
      border-radius: 50%;
      background: conic-gradient(var(--accent) 0deg, rgba(79, 142, 247, 0.2) 0deg);
      z-index: 3;
      pointer-events: none;
      transition: background 0.1s linear;
      -webkit-mask: radial-gradient(circle, transparent 65%, black 66%);
      mask: radial-gradient(circle, transparent 65%, black 66%);
    `;

    const bigCircle = document.getElementById('voiceBigCircle');
    if (bigCircle) {
      bigCircle.style.position = 'relative';
      bigCircle.insertBefore(progress, bigCircle.firstChild);
    }

    return progress;
  }

  // Обновить прогресс круговой шкалы
  function updateCircularProgress(elapsedMs, maxDurationMs = 60000) {
    const progress = document.getElementById('circleVideoProgress');
    if (!progress) return;

    const percent = Math.min(elapsedMs / maxDurationMs, 1);
    const degrees = percent * 360;
    
    // Цвет меняется от синего к красному при приближении к лимиту
    const color = percent > 0.9 ? '#e74c3c' : 'var(--accent)';
    const bgColor = 'rgba(79, 142, 247, 0.2)';
    progress.style.background = `conic-gradient(${color} ${degrees}deg, ${bgColor} ${degrees}deg)`;
  }

  // Удалить круговой прогресс
  function removeCircularProgress() {
    const progress = document.getElementById('circleVideoProgress');
    if (progress) progress.remove();
  }

  // ==================== НАСТРОЙКА UI ДЛЯ РЕЖИМОВ ====================
  function setupVoiceModeUI() {
    const bigCircle = document.getElementById('voiceBigCircle');
    const video = document.getElementById('voiceRecordingVideo');
    const overlayStatus = document.getElementById('voiceRecOverlayStatus');
    const modeIndicator = document.getElementById('voiceModeIndicator');

    // Показываем текстовые индикаторы при записи голоса
    if (overlayStatus) {
      overlayStatus.style.display = '';
      overlayStatus.textContent = 'Запись голоса…';
    }
    if (modeIndicator) {
      modeIndicator.style.display = '';
      modeIndicator.innerHTML = `<svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24" style="display:inline-block;margin-right:6px;vertical-align:middle;"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M19 10a7 7 0 01-14 0M12 19v3M8 22h8"/></svg>ГОЛОС`;
      modeIndicator.style.color = 'var(--accent)';
    }

    if (bigCircle) {
      bigCircle.style.background = 'var(--red)';
      bigCircle.style.animation = 'recordPulse .6s ease-in-out infinite';
      bigCircle.style.border = 'none';
      bigCircle.style.boxShadow = '0 0 40px rgba(255,0,0,0.6)';
    }

    if (video) {
      video.classList.remove('active');
      video.srcObject = null;
    }

    const svg = bigCircle?.querySelector('svg');
    if (svg) {
      svg.style.display = 'block';
      svg.style.opacity = '1';
    }

    removeCircularProgress();
  }

  async function setupVideoModeUI(stream) {
    const bigCircle = document.getElementById('voiceBigCircle');
    const video = document.getElementById('voiceRecordingVideo');
    const overlayStatus = document.getElementById('voiceRecOverlayStatus');
    const modeIndicator = document.getElementById('voiceModeIndicator');

    // Сохраняем ссылку на поток для переключения камеры
    videoStream = stream;
    
    // Сбрасываем facingMode при начале новой записи (всегда начинаем с фронтальной камеры)
    currentFacingMode = 'user';
    console.log('🎥 Video mode UI setup, facingMode reset to:', currentFacingMode);

    // Скрываем текстовые индикаторы при записи видео
    if (overlayStatus) overlayStatus.style.display = 'none';
    if (modeIndicator) modeIndicator.style.display = 'none';

    if (bigCircle) {
      bigCircle.style.background = '#000';
      bigCircle.style.animation = 'none';
      bigCircle.style.border = '3px solid var(--accent)';
      bigCircle.style.boxShadow = '0 0 30px rgba(79, 142, 247, 0.4)';
      bigCircle.style.overflow = 'hidden';
    }

    if (video) {
      video.classList.add('active');
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      // CSS: зеркалим для фронтальной (user), не зеркалим для задней (environment)
      // Принудительно сбрасываем transform перед установкой нового значения
      video.style.transform = '';
      video.offsetHeight; // Force reflow
      video.style.transform = currentFacingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)';
      video.style.background = '#000';
      console.log('🎥 Video transform set to:', video.style.transform, 'facingMode:', currentFacingMode);
      try {
        await video.play();
      } catch (e) {
        console.error('Video play error:', e);
      }
    }

    const svg = bigCircle?.querySelector('svg');
    if (svg) {
      svg.style.display = 'none';
    }

    // Проверяем доступность задней камеры
    checkRearCameraAvailability();

    createCircularProgress();
  }

  // ==================== ПЕРЕКЛЮЧЕНИЕ КАМЕРЫ ====================
  // Переключение между фронтальной и задней камерой
  async function switchCamera() {
    if (!videoStream) {
      console.warn('⚠️ No video stream available for camera switch');
      showToast('Видеопоток не активен');
      return false;
    }

    // Проверяем, что запись активна
    if (typeof voiceSession === 'undefined' || !voiceSession || !voiceSession.recorder) {
      console.warn('⚠️ Recording not active');
      showToast('Запись не активна');
      return false;
    }

    const newFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
    console.log('🔄 Switching camera from', currentFacingMode, 'to', newFacingMode);

    try {
      // Сначала запрашиваем новый поток (еще не останавливая старый!)
      // Это важно чтобы MediaRecorder не остановился из-за отсутствия видеодорожек
      const newStream = await Promise.race([
        navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            width: { ideal: 720 },
            height: { ideal: 1280 },
            facingMode: { ideal: newFacingMode }
          }
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('getUserMedia timeout')), 5000)
        )
      ]);

      const newVideoTracks = newStream.getVideoTracks();
      if (newVideoTracks.length === 0) {
        throw new Error('No video tracks in new stream');
      }

      const newVideoTrack = newVideoTracks[0];
      const oldVideoTracks = videoStream.getVideoTracks();

      // Добавляем новый трек ПЕРЕД удалением старого чтобы поток не был пустым
      videoStream.addTrack(newVideoTrack);
      console.log('✅ Added new video track:', newVideoTrack.label);

      // Теперь удаляем и останавливаем старый трек
      if (oldVideoTracks.length > 0) {
        const oldVideoTrack = oldVideoTracks[0];
        videoStream.removeTrack(oldVideoTrack);
        oldVideoTrack.stop();
        console.log('⏹️ Stopped old video track:', oldVideoTrack.label);
      }

      // Обновляем video element
      const video = document.getElementById('voiceRecordingVideo');
      if (video) {
        video.srcObject = videoStream;
        // CSS: зеркалим для фронтальной камеры, не зеркалим для задней
        // Принудительно сбрасываем и переустанавливаем transform для гарантии применения
        video.style.transform = '';
        video.offsetHeight; // Force reflow
        const newTransform = newFacingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)';
        video.style.transform = newTransform;
        console.log('🎥 Camera switched, transform:', newTransform, 'facingMode:', newFacingMode);
      }

      // Обновляем состояние
      currentFacingMode = newFacingMode;

      // Обновляем voiceSession если он существует
      if (voiceSession) {
        voiceSession.facingMode = newFacingMode;
      }

      showToast(newFacingMode === 'user' ? '📱 Фронтальная камера' : '🔙 Задняя камера', { duration: 800 });
      console.log('✅ Camera switched to:', newFacingMode);
      return true;

    } catch (err) {
      console.error('❌ Failed to switch camera:', err.name, err.message);

      let errorMsg = 'Не удалось переключить камеру';
      if (err.name === 'NotFoundError') {
        errorMsg = 'Камера не найдена';
        // Скрываем кнопку переключения если задней камеры нет
        const flipBtn = document.getElementById('voiceRecFlipCameraBtn');
        if (flipBtn && newFacingMode === 'environment') {
          flipBtn.style.display = 'none';
        }
      } else if (err.name === 'NotAllowedError') {
        errorMsg = 'Разрешите доступ к камере';
      } else if (err.name === 'NotReadableError') {
        errorMsg = 'Камера занята другим приложением';
      } else if (err.message === 'getUserMedia timeout') {
        errorMsg = 'Превышен таймаут при переключении камеры';
      }

      showToast(errorMsg);
      return false;
    }
  }

  // Получить текущий facingMode
  function getCurrentFacingMode() {
    return currentFacingMode;
  }

  // Установить видеопоток (вызывается при начале записи)
  function setVideoStream(stream) {
    videoStream = stream;
    // Сбрасываем facingMode в 'user' по умолчанию
    currentFacingMode = 'user';
    // Проверяем наличие задней камеры
    checkRearCameraAvailability();
  }

  // Очистить видеопоток (вызывается при остановке записи)
  function clearVideoStream() {
    if (videoStream) {
      videoStream.getTracks().forEach(t => t.stop());
      videoStream = null;
    }
    currentFacingMode = 'user';
  }

  // Проверить доступность задней камеры
  async function checkRearCameraAvailability() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      const hasRearCamera = videoDevices.length > 1;

      const flipBtn = document.getElementById('voiceRecFlipCameraBtn');
      if (flipBtn) {
        flipBtn.style.display = hasRearCamera ? 'flex' : 'none';
      }

      console.log('📹 Camera check:', videoDevices.length, 'video devices found');
      return hasRearCamera;
    } catch (err) {
      console.warn('⚠️ Failed to enumerate cameras:', err);
      return false;
    }
  }

  // ==================== SWIPE UP LOCK ====================
  // Создать UI для свайпа вверх с замочком
  function createSwipeUpLockUI() {
    let swipeContainer = document.getElementById('swipeLockContainer');
    if (swipeContainer) swipeContainer.remove();

    swipeContainer = document.createElement('div');
    swipeContainer.id = 'swipeLockContainer';
    swipeContainer.style.cssText = `
      position: absolute;
      bottom: 120px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      z-index: 10001;
      pointer-events: none;
    `;

    // Иконка замочка
    const lockIcon = document.createElement('div');
    lockIcon.id = 'swipeLockIcon';
    lockIcon.innerHTML = LOCK_ICON_SVG;
    lockIcon.style.cssText = `
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0.5;
      transition: all 0.3s;
      border: 2px solid rgba(255, 255, 255, 0.3);
      color: white;
    `;
    lockIcon.querySelector('svg').style.width = '24px';
    lockIcon.querySelector('svg').style.height = '24px';

    // Текст подсказки
    const hint = document.createElement('div');
    hint.id = 'swipeLockHint';
    hint.textContent = 'Свайп вверх для блокировки';
    hint.style.cssText = `
      font-size: 12px;
      color: rgba(255, 255, 255, 0.7);
      white-space: nowrap;
      transition: all 0.3s;
    `;

    swipeContainer.appendChild(lockIcon);
    swipeContainer.appendChild(hint);

    const overlay = document.getElementById('voiceRecordingOverlay');
    if (overlay) {
      overlay.appendChild(swipeContainer);
    }

    return swipeContainer;
  }

  // Активировать замочек (при свайпе вверх)
  function activateLock() {
    const lockIcon = document.getElementById('swipeLockIcon');
    const hint = document.getElementById('swipeLockHint');
    
    if (lockIcon) {
      lockIcon.style.opacity = '1';
      lockIcon.style.background = 'var(--accent)';
      lockIcon.style.borderColor = 'var(--accent)';
      lockIcon.style.transform = 'scale(1.2)';
      lockIcon.innerHTML = UNLOCK_ICON_SVG;
      lockIcon.querySelector('svg').style.width = '24px';
      lockIcon.querySelector('svg').style.height = '24px';
      lockIcon.querySelector('svg').style.stroke = 'white';
    }
    
    if (hint) {
      hint.textContent = 'Запись заблокирована';
      hint.style.color = 'var(--accent)';
    }

    return true;
  }

  // Удалить UI свайпа
  function removeSwipeLockUI() {
    const swipeContainer = document.getElementById('swipeLockContainer');
    if (swipeContainer) swipeContainer.remove();
  }

  // ==================== ШИФРОВАНИЕ И ОТПРАВКА ====================
  // Отправка кружочка с ШИФРОВАНИЕМ (E2EE)
  async function sendVoiceCircle(audioBlob, duration, recipientId, roomId = null) {
    if (!audioBlob || !duration) {
      console.error('❌ Invalid audio data for voice circle');
      return null;
    }

    try {
      // Конвертировать blob в base64 для передачи
      const arrayBuffer = await audioBlob.arrayBuffer();
      const base64Audio = arrayToBase64(new Uint8Array(arrayBuffer));

      // Подготовить данные для отправки
      const circleData = {
        type: 'voiceCircle',
        audio: base64Audio,
        duration: Math.round(duration),
        isCircle: true,
        timestamp: Date.now()
      };

      // Зашифровать данные если есть crypto_engine (E2EE)
      if (window.crypto_engine && recipientId) {
        return await encryptAndSendVoiceData(circleData, recipientId, roomId, 'circle');
      }

      return circleData;
    } catch (err) {
      console.error('❌ Error in sendVoiceCircle:', err);
      return null;
    }
  }

  // Отправка обычного голос сообщения с ШИФРОВАНИЕМ (E2EE)
  async function sendVoiceMessage(audioBlob, duration, recipientId, roomId = null) {
    if (!audioBlob || !duration) {
      console.error('❌ Invalid audio data for voice message');
      return null;
    }

    try {
      // Конвертировать blob в base64
      const arrayBuffer = await audioBlob.arrayBuffer();
      const base64Audio = arrayToBase64(new Uint8Array(arrayBuffer));

      // Подготовить данные
      const voiceData = {
        type: 'voiceMessage',
        audio: base64Audio,
        duration: Math.round(duration),
        isCircle: false,
        timestamp: Date.now()
      };

      // Зашифровать если есть E2EE
      if (window.crypto_engine && recipientId) {
        return await encryptAndSendVoiceData(voiceData, recipientId, roomId, 'message');
      }

      return voiceData;
    } catch (err) {
      console.error('❌ Error in sendVoiceMessage:', err);
      return null;
    }
  }

  // ==================== ВНУТРЕННИЕ ФУНКЦИИ ШИФРОВАНИЯ ====================
  // Зашифровать и отправить голосовые данные через E2EE
  async function encryptAndSendVoiceData(voiceData, recipientId, roomId, type) {
    try {
      const plaintext = JSON.stringify(voiceData);

      // Если это чат между двумя юзерами
      if (recipientId && !roomId) {
        const ratchet = getRatchetForUser(recipientId);
        if (!ratchet) {
          console.error('❌ No ratchet found for user:', recipientId);
          return voiceData; // Отправить незашифрованным как fallback
        }

        const encrypted = await ratchet.encryptMessage(plaintext);
        
        return {
          type: type,
          encrypted: encrypted.ciphertext,
          iv: encrypted.iv,
          messageNumber: encrypted.messageNumber,
          dhPublicKey: await window.crypto_engine.exportPublicKey(window.crypto_engine.myKeys.ecdh),
          to: recipientId,
          isVoice: true,
          isCircle: voiceData.isCircle
        };
      }

      // Если это в комнате/группе
      if (roomId) {
        const roomRatchet = getRatchetForRoom(roomId);
        if (!roomRatchet) {
          console.error('❌ No ratchet found for room:', roomId);
          return voiceData;
        }

        const encrypted = await roomRatchet.encryptMessage(plaintext);
        
        return {
          type: type,
          encrypted: encrypted.ciphertext,
          iv: encrypted.iv,
          messageNumber: encrypted.messageNumber,
          roomId: roomId,
          isVoice: true,
          isCircle: voiceData.isCircle
        };
      }
    } catch (err) {
      console.error('❌ Encryption error:', err);
      return voiceData; // Fallback
    }
  }

  // Расшифровать голосовые данные
  async function decryptVoiceData(encryptedMessage, senderId, roomId = null) {
    try {
      if (!encryptedMessage.encrypted || !encryptedMessage.iv) {
        console.error('❌ Missing encrypted data or IV');
        return null;
      }

      let ratchet = null;

      if (senderId && !roomId) {
        ratchet = getRatchetForUser(senderId);
      } else if (roomId) {
        ratchet = getRatchetForRoom(roomId);
      }

      if (!ratchet) {
        console.error('❌ No ratchet found for decryption');
        return null;
      }

      // Импортировать public key если нужен рэтчет
      if (encryptedMessage.dhPublicKey && window.crypto_engine) {
        const remotePublicKey = await window.crypto_engine.importPublicKey(
          encryptedMessage.dhPublicKey,
          'ECDH'
        );
        await ratchet.ratchetStep(remotePublicKey);
      }

      const plaintext = await ratchet.decryptMessage(
        encryptedMessage.encrypted,
        encryptedMessage.iv,
        encryptedMessage.messageNumber
      );

      return JSON.parse(plaintext);
    } catch (err) {
      console.error('❌ Decryption error:', err);
      return null;
    }
  }


  // ==================== ВИЗУАЛИЗАЦИЯ КРУЖОЧКОВ ====================
  // Визуализация кружочка при воспроизведении
  function renderVoiceCircle(container, circleData) {
    if (!container) return;
    
    const circle = document.createElement('div');
    circle.className = 'voice-circle';
    const isVideo = circleData.isVideo || false;
    circle.style.cssText = `
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: linear-gradient(135deg, ${isVideo ? '#e74c3c' : 'var(--accent)'}, ${isVideo ? '#c0392b' : 'var(--accent2)'});
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      position: relative;
      transition: transform 0.2s, background 0.3s, box-shadow 0.3s;
      box-shadow: 0 2px 8px rgba(79, 142, 247, 0.3);
      flex-shrink: 0;
      border: 2px solid rgba(255, 255, 255, 0.2);
    `;

    // Плей кнопка с иконкой микрофона или камеры
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.innerHTML = isVideo ? CAMERA_ICON : MIC_ICON;
    playBtn.style.color = 'var(--accent)';
    playBtn.style.cssText = `
      background: none;
      border: none;
      color: white;
      font-size: 32px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      transition: transform 0.2s, filter 0.2s;
      filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
    `;

    // Время в центре - исправлено форматирование
    const timeDiv = document.createElement('div');
    timeDiv.className = 'voice-circle-time';
    const duration = Math.max(0, Math.min(3600, parseInt(circleData.duration) || 0));
    timeDiv.textContent = formatTime(duration);
    timeDiv.style.cssText = `
      position: absolute;
      font-size: 10px;
      color: rgba(255, 255, 255, 0.9);
      white-space: nowrap;
      font-weight: 600;
      bottom: 6px;
      left: 50%;
      transform: translateX(-50%);
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
    `;

    circle.appendChild(playBtn);
    circle.appendChild(timeDiv);

    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playVoiceCircle(circleData);
      playBtn.style.transform = 'scale(0.85)';
      setTimeout(() => { playBtn.style.transform = 'scale(1)'; }, 100);
    });

    circle.addEventListener('mouseenter', () => {
      circle.style.transform = 'scale(1.12)';
      circle.style.boxShadow = '0 4px 16px rgba(79, 142, 247, 0.5)';
    });
    circle.addEventListener('mouseleave', () => {
      circle.style.transform = 'scale(1)';
      circle.style.boxShadow = '0 2px 8px rgba(79, 142, 247, 0.3)';
    });

    container.appendChild(circle);
    return circle;
  }

  // Отобразить голос сообщение (волнграфик или плеер)
  function renderVoiceMessage(container, voiceData) {
    if (!container) return;

    const voiceDiv = document.createElement('div');
    voiceDiv.className = 'voice-message';
    voiceDiv.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: rgba(79, 142, 247, 0.15);
      border: 1px solid var(--accent);
      border-radius: 12px;
      min-width: 200px;
      cursor: pointer;
    `;

    // Плей кнопка
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.innerHTML = PLAY_ICON_SVG;
    playBtn.style.color = 'var(--accent)';
    playBtn.style.cssText = `
      background: var(--accent);
      border: none;
      color: white;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-size: 12px;
      transition: all 0.2s;
    `;

    // Время
    const timeSpan = document.createElement('span');
    timeSpan.textContent = formatTime(voiceData.duration);
    timeSpan.style.cssText = `
      font-size: 13px;
      color: var(--text2);
      font-weight: 500;
      flex: 1;
    `;

    voiceDiv.appendChild(playBtn);
    voiceDiv.appendChild(timeSpan);

    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      playVoiceCircle(voiceData);
      playBtn.innerHTML = PAUSE_ICON_SVG;
      playBtn.style.color = '#e74c3c';
      setTimeout(() => { playBtn.innerHTML = PLAY_ICON_SVG; playBtn.style.color = 'var(--accent)'; }, 1000);
    });

    container.appendChild(voiceDiv);
    return voiceDiv;
  }

  function playVoiceCircle(voiceData) {
    if (!voiceData.blob && !voiceData.audio) {
      console.error('❌ No audio data to play');
      return;
    }

    try {
      let blob = voiceData.blob;
      const isVideo = voiceData.isVideo || false;

      let mimeType = voiceData.mimeType;
      if (!mimeType) {
        mimeType = isVideo ? 'video/webm' : 'audio/webm';
      }
      const cleanMimeType = mimeType.split(';')[0];

      if (!blob && voiceData.audio) {
        try {
          const binaryString = atob(voiceData.audio);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          blob = new Blob([bytes], { type: cleanMimeType });
        } catch (e) {
          console.error('❌ Failed to decode base64:', e);
          return;
        }
      }

      if (!blob) {
        console.error('❌ No valid blob created');
        return;
      }

      const url = URL.createObjectURL(blob);

      if (isVideo) {
        const video = document.createElement('video');
        video.controls = true;
        video.playsInline = true;
        // Для фронтальной камеры применяем scaleX(-1) чтобы отзеркалить видео
        const facingMode = voiceData.facingMode || 'user';
        const mirrorTransform = facingMode === 'user' ? 'scaleX(-1)' : '';
        video.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%)${mirrorTransform};max-width:90vw;max-height:90vh;border-radius:8px;z-index:9999;background:#000;`;
        video.addEventListener('ended', () => {
          if (video.parentNode) document.body.removeChild(video);
          URL.revokeObjectURL(url);
        });
        video.addEventListener('error', () => {
          console.error('❌ Video load error in modal:', video.error);
          if (video.parentNode) document.body.removeChild(video);
          URL.revokeObjectURL(url);
          if (typeof showToast === 'function') {
            showToast('Формат видео не поддерживается');
          }
        });
        document.body.appendChild(video);
        video.src = url;
        video.play().catch(err => {
          console.error('❌ Video play error:', err.name, err.message);
          if (err.name === 'NotSupportedError' && typeof showToast === 'function') {
            showToast('Формат видео не поддерживается в этом браузере');
          }
        });
      } else {
        const audio = new Audio();
        audio.addEventListener('ended', () => {
          URL.revokeObjectURL(url);
        });
        audio.src = url;
        audio.play().catch(err => console.error('❌ Audio play error:', err));
      }
    } catch (err) {
      console.error('❌ Error playing voice:', err);
    }
  }

  // Форматирование времени - исправлено
  function formatTime(seconds) {
    const num = Math.max(0, parseInt(seconds) || 0);
    if (isNaN(num) || num < 0) return '0:00';
    const mins = Math.floor(num / 60);
    const secs = Math.floor(num % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  // ==================== ПРОФИЛЬ И СТАТИСТИКА ====================
  // Добавить кружочек в профайл юзера (как в Telegram)
  function addCircleToProfile(userId, circleData) {
    if (!userId) return;
    
    const profile = window.contacts?.find(c => normUid(c.uuid) === normUid(userId));
    if (!profile) return;

    if (!profile.voiceCircles) profile.voiceCircles = [];
    profile.voiceCircles.push({
      id: generateSecureId(12),
      audio: circleData.audio,
      duration: circleData.duration,
      addedAt: Date.now()
    });

    // Ограничение: не более 10 кружочков
    if (profile.voiceCircles.length > 10) {
      profile.voiceCircles.shift();
    }
  }

  // ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
  // Получить рэтчет для юзера (из existing code)
  function getRatchetForUser(userId) {
    if (!window.ratchetState) return null;
    return window.ratchetState[normUid(userId)];
  }

  // Получить рэтчет для комнаты
  function getRatchetForRoom(roomId) {
    if (!window.roomRatchets) return null;
    return window.roomRatchets[roomId];
  }

  // Преобразовать Uint8Array в base64
  function arrayToBase64(arr) {
    let binary = '';
    for (let i = 0; i < arr.byteLength; i++) {
      binary += String.fromCharCode(arr[i]);
    }
    return btoa(binary);
  }

  return {
    init,
    toggleCircleMode,
    getCircleMode,
    sendVoiceCircle,
    sendVoiceMessage,
    decryptVoiceData,
    renderVoiceCircle,
    renderVoiceMessage,
    playVoiceCircle,
    addCircleToProfile,
    formatTime,
    // Новые функции для UI
    startWaveformVisualization,
    stopWaveformVisualization,
    setupVoiceModeUI,
    setupVideoModeUI,
    updateCircularProgress,
    createSwipeUpLockUI,
    removeSwipeLockUI,
    activateLock,
    updateButtonIcon,
    // Функции для переключения камеры
    switchCamera,
    getCurrentFacingMode,
    setVideoStream,
    clearVideoStream,
    checkRearCameraAvailability
  };
})();

// Инициализация при загрузке
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => VoiceCirclesModule.init());
} else {
  VoiceCirclesModule.init();
}
