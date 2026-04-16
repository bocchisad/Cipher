// ==================== VOICE RECORD HANDLER (TELEGRAM-STYLE) ====================
// Обработчик кнопки микрофона:
// • Click → Переключение режима (кружочки ↔ голос)
// • Hold (долгое нажатие) → Запись голоса

const VoiceRecordHandler = (() => {
  let holdTimer = null;
  let isHolding = false;
  let holdStartTime = 0;
  const HOLD_THRESHOLD = 300; // минимум 300мс чтобы считать за долгое нажатие

  function init() {
    const recordBtn = document.getElementById('recordBtn');
    if (!recordBtn) {
      console.warn('⚠️ recordBtn not found');
      setTimeout(init, 500);
      return;
    }

    // Удалить старый onclick обработчик если есть
    recordBtn.onclick = null;

    // Добавить новые обработчики
    recordBtn.addEventListener('mousedown', onRecordBtnDown);
    recordBtn.addEventListener('mouseup', onRecordBtnUp);
    recordBtn.addEventListener('mouseleave', onRecordBtnUp);

    // Для мобильных устройств добавить touch события
    recordBtn.addEventListener('touchstart', onRecordBtnDown);
    recordBtn.addEventListener('touchend', onRecordBtnUp);
    recordBtn.addEventListener('touchcancel', onRecordBtnUp);

    console.log('✅ Voice Record Handler initialized (Telegram-style)');
  }

  // ==================== ОБРАБОТЧИКИ НАЖАТИЙ ====================
  function onRecordBtnDown(e) {
    if (isHolding) return;

    holdStartTime = Date.now();
    isHolding = true;

    // Задержка перед началом записи (чтобы отличить click от hold)
    holdTimer = setTimeout(() => {
      if (isHolding && typeof startRecordingVoice === 'function') {
        startRecordingVoice();
        console.log('🎙️ Recording started (hold detected)');
      }
    }, HOLD_THRESHOLD);

    e.preventDefault();
  }

  function onRecordBtnUp(e) {
    const holdDuration = Date.now() - holdStartTime;

    // Очистить таймер
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }

    if (isHolding) {
      // Если запись идет - остановить её
      if (typeof voiceSession !== 'undefined' && voiceSession && voiceSession.recorder) {
        if (voiceSession.recorder.state === 'recording' || voiceSession.recorder.state === 'paused') {
          // Отправить голос
          const sendBtn = document.getElementById('voiceRecSendBtn');
          if (sendBtn && typeof sendBtn.onclick === 'function') {
            sendBtn.onclick();
          }
          console.log('✅ Voice recording stopped and sent');
        }
      } else if (holdDuration < HOLD_THRESHOLD) {
        // Если это был просто click (< 300мс) - переключить режим
        if (typeof VoiceCirclesModule !== 'undefined' && VoiceCirclesModule.toggleCircleMode) {
          VoiceCirclesModule.toggleCircleMode();
          updateRecordBtnIndicator();
          console.log('🔄 Voice mode toggled');
        }
      }
    }

    isHolding = false;
    e.preventDefault();
  }

  // ==================== ВИЗУАЛЬНЫЙ ИНДИКАТОР ====================
  function updateRecordBtnIndicator() {
    const recordBtn = document.getElementById('recordBtn');
    const voiceModeToggle = document.getElementById('voiceModeToggle');
    
    if (!recordBtn) return;

    const isCircle = typeof VoiceCirclesModule !== 'undefined' 
      ? VoiceCirclesModule.getCircleMode() 
      : false;

    // Обновить цвет
    if (isCircle) {
      recordBtn.style.color = 'var(--accent)';
      recordBtn.title = '🔵 Кружочки (активны)\n\nНажми для переключения\nЗажми для записи';
    } else {
      recordBtn.style.color = 'inherit';
      recordBtn.title = '🎤 Голос сообщение (активны)\n\nНажми для переключения\nЗажми для записи';
    }

    // Синхронизировать с кнопкой переключения режима если она есть
    if (voiceModeToggle) {
      if (isCircle) {
        voiceModeToggle.style.color = 'var(--accent)';
      } else {
        voiceModeToggle.style.color = 'inherit';
      }
    }
  }

  // ==================== PUBLIC API ====================
  return {
    init,
    updateRecordBtnIndicator,
    setHoldThreshold: (ms) => { HOLD_THRESHOLD = ms; }
  };
})();

// Инициализация
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => VoiceRecordHandler.init(), 100);
  });
} else {
  setTimeout(() => VoiceRecordHandler.init(), 100);
}
