// ==================== VOICE RECORD HANDLER (TELEGRAM-STYLE) ====================
// Обработчик кнопки микрофона/камеры:
// • Короткий тап (менее 200мс) → Переключение режима (кружочки ↔ голос)
// • Hold (долгое нажатие) → Запись голоса/видео
// • Свайп вверх → Блокировка записи (отпустить кнопку = продолжить запись)

const VoiceRecordHandler = (() => {
  let holdTimer = null;
  let isHolding = false;
  let holdStartTime = 0;
  let isLocked = false; // Блокировка записи (свайп вверх)
  let startY = 0;
  let currentY = 0;
  
  const HOLD_THRESHOLD = 200; // минимум 200мс чтобы считать за долгое нажатие
  const SWIPE_THRESHOLD = 60; // минимальное расстояние свайпа для блокировки

  function init() {
    const recordBtn = document.getElementById('recordBtn');
    if (!recordBtn) {
      console.warn('recordBtn not found');
      return;
    }

    // Удалить старые inline обработчики
    recordBtn.onclick = null;
    recordBtn.onmousedown = null;
    recordBtn.onmouseup = null;
    
    // Удалить старые обработчики клона
    const newBtn = recordBtn.cloneNode(true);
    recordBtn.parentNode.replaceChild(newBtn, recordBtn);

    // Добавить новые обработчики мыши
    newBtn.addEventListener('mousedown', onRecordBtnDown);
    newBtn.addEventListener('mouseup', onRecordBtnUp);
    newBtn.addEventListener('mouseleave', onRecordBtnUp);

    // Для мобильных устройств добавить touch события
    newBtn.addEventListener('touchstart', onTouchStart, { passive: false });
    newBtn.addEventListener('touchmove', onTouchMove, { passive: false });
    newBtn.addEventListener('touchend', onTouchEnd, { passive: false });
    newBtn.addEventListener('touchcancel', onTouchEnd, { passive: false });

    console.log('Record handler initialized (with swipe lock)');
  }

  // ==================== MOUSE EVENTS ====================
  function onRecordBtnDown(e) {
    if (isHolding) return;
    
    holdStartTime = Date.now();
    isHolding = true;
    isLocked = false;
    
    // Создать UI для свайпа
    if (typeof VoiceCirclesModule !== 'undefined' && VoiceCirclesModule.createSwipeUpLockUI) {
      VoiceCirclesModule.createSwipeUpLockUI();
    }

    // Задержка перед началом записи (чтобы отличить click от hold)
    holdTimer = setTimeout(() => {
      if (isHolding && typeof toggleRecord === 'function') {
        toggleRecord();
      }
    }, HOLD_THRESHOLD);

    e.preventDefault();
    e.stopPropagation();
  }

  function onRecordBtnUp(e) {
    const holdDuration = Date.now() - holdStartTime;

    // Очистить таймер
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }

    if (isHolding) {
      // Если запись заблокирована свайпом - продолжаем запись
      if (isLocked && typeof voiceSession !== 'undefined' && voiceSession) {
        // Ничего не делаем - запись продолжается
        console.log('Recording locked - continuing');
      }
      // Если запись идет и не заблокирована - остановить её
      else if (typeof voiceSession !== 'undefined' && voiceSession && voiceSession.recorder) {
        if (voiceSession.recorder.state === 'recording' || voiceSession.recorder.state === 'paused') {
          // Отправить голос - используем кнопку отправки из текущего UI
          const sendBtn = document.getElementById('voiceRecOverlaySendBtn') || document.getElementById('voiceRecSendBtn');
          if (sendBtn && typeof sendBtn.onclick === 'function') {
            sendBtn.onclick();
          } else {
            // Fallback - останавливаем напрямую
            try {
              voiceSession.recorder.stop();
            } catch (_) {}
          }
        }
      } else if (holdDuration < HOLD_THRESHOLD) {
        // Если это был просто click (< 200мс) - переключить режим
        if (typeof VoiceCirclesModule !== 'undefined' && VoiceCirclesModule.toggleCircleMode) {
          VoiceCirclesModule.toggleCircleMode();
        }
      }
    }

    // Удалить UI свайпа
    if (typeof VoiceCirclesModule !== 'undefined' && VoiceCirclesModule.removeSwipeLockUI) {
      VoiceCirclesModule.removeSwipeLockUI();
    }

    isHolding = false;
    isLocked = false;
    e.preventDefault();
    e.stopPropagation();
  }

  // ==================== TOUCH EVENTS (SWIPE) ====================
  function onTouchStart(e) {
    if (isHolding) return;
    
    const touch = e.touches[0];
    startY = touch.clientY;
    currentY = startY;
    
    onRecordBtnDown(e);
  }

  function onTouchMove(e) {
    if (!isHolding) return;
    
    const touch = e.touches[0];
    currentY = touch.clientY;
    
    const deltaY = startY - currentY; // Положительное = свайп вверх
    
    // Если свайп вверх достаточно далеко - активируем блокировку
    if (deltaY > SWIPE_THRESHOLD && !isLocked) {
      isLocked = true;
      
      // Визуальная обратная связь
      if (typeof VoiceCirclesModule !== 'undefined' && VoiceCirclesModule.activateLock) {
        VoiceCirclesModule.activateLock();
      }
      
      // Вибрация (если поддерживается)
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
      
      console.log('Recording locked via swipe up');
    }
    
    e.preventDefault();
  }

  function onTouchEnd(e) {
    onRecordBtnUp(e);
    startY = 0;
    currentY = 0;
  }

  // ==================== PUBLIC API ====================
  function isRecordingLocked() {
    return isLocked;
  }

  return {
    init,
    isRecordingLocked
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
