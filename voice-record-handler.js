// ==================== VOICE RECORD HANDLER (TELEGRAM-STYLE) ====================
// Обработчик кнопки микрофона:
// • Quick click (~100мс) → Переключение режима (кружочки ↔ голос)
// • Hold (долгое нажатие) → Запись голоса

const VoiceRecordHandler = (() => {
  let holdTimer = null;
  let isHolding = false;
  let holdStartTime = 0;
  const HOLD_THRESHOLD = 200; // минимум 200мс чтобы считать за долгое нажатие

  function init() {
    const recordBtn = document.getElementById('recordBtn');
    if (!recordBtn) {
      console.warn('recordBtn not found');
      return;
    }

    // Удалить старый onclick обработчик если есть
    recordBtn.onclick = null;
    recordBtn.onmousedown = null;
    recordBtn.onmouseup = null;

    // Добавить новые обработчики
    recordBtn.addEventListener('mousedown', onRecordBtnDown);
    recordBtn.addEventListener('mouseup', onRecordBtnUp);
    recordBtn.addEventListener('mouseleave', onRecordBtnUp);

    // Для мобильных устройств добавить touch события
    recordBtn.addEventListener('touchstart', onRecordBtnDown);
    recordBtn.addEventListener('touchend', onRecordBtnUp);
    recordBtn.addEventListener('touchcancel', onRecordBtnUp);

    console.log('Record handler initialized');
  }

  // ==================== ОБРАБОТЧИКИ НАЖАТИЙ ====================
  function onRecordBtnDown(e) {
    if (isHolding) return;

    holdStartTime = Date.now();
    isHolding = true;

    // Задержка перед началом записи (чтобы отличить click от hold)
    holdTimer = setTimeout(() => {
      if (isHolding && typeof toggleRecord === 'function') {
        toggleRecord();
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
        }
      } else if (holdDuration < HOLD_THRESHOLD) {
        // Если это был просто click (< 200мс) - переключить режим
        if (typeof VoiceCirclesModule !== 'undefined' && VoiceCirclesModule.toggleCircleMode) {
          VoiceCirclesModule.toggleCircleMode();
        }
      }
    }

    isHolding = false;
    e.preventDefault();
  }

  return {
    init
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
