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
    newBtn.addEventListener('mouseleave', onRecordBtnLeave);

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
        // FIX: Lock recording on long press so it doesn't auto-send on release
        isLocked = true;
        toggleRecord();
        console.log('Recording locked via long press');
      }
    }, HOLD_THRESHOLD);

    e.preventDefault();
    e.stopPropagation();
  }

  // Обработчик mouseleave — не останавливает запись если overlay активен
  function onRecordBtnLeave(e) {
    const isRecordingActive = typeof voiceSession !== 'undefined' && voiceSession && voiceSession.recorder &&
      (voiceSession.recorder.state === 'recording' || voiceSession.recorder.state === 'paused');
    
    // Если запись активна и overlay виден — не останавливаем (пользователь кликает на кнопки в overlay)
    const overlayActive = document.getElementById('voiceRecordingOverlay')?.classList.contains('active');
    if (isRecordingActive && overlayActive) {
      console.log('Mouse left recordBtn but recording continues (overlay active)');
      // Сбрасываем состояние но не останавливаем запись
      isHolding = false;
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      // Удаляем UI свайпа
      if (typeof VoiceCirclesModule !== 'undefined' && VoiceCirclesModule.removeSwipeLockUI) {
        VoiceCirclesModule.removeSwipeLockUI();
      }
      return;
    }
    
    // Иначе обрабатываем как обычный mouseup
    onRecordBtnUp(e);
  }

  function onRecordBtnUp(e) {
    const holdDuration = Date.now() - holdStartTime;

    // Очистить таймер
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }

    // Проверяем, не был ли только что клик на flip camera (блокируем остановку записи)
    const justFlipped = typeof voiceSession !== 'undefined' && voiceSession &&
      voiceSession._justFlipped && (Date.now() - voiceSession._justFlipped) < 500;

    if (isHolding) {
      const isRecordingActive = typeof voiceSession !== 'undefined' && voiceSession && voiceSession.recorder &&
        (voiceSession.recorder.state === 'recording' || voiceSession.recorder.state === 'paused');

      if (justFlipped) {
        // Если только что переключили камеру - не останавливаем запись
        console.log('Recording continues after camera flip');
      } else if (isLocked && isRecordingActive) {
        console.log('Recording locked - continuing');
      } else if (isRecordingActive) {
        const sendBtn = document.getElementById('voiceRecOverlaySendBtn') || document.getElementById('voiceRecSendBtn');
        if (sendBtn && typeof sendBtn.onclick === 'function') {
          sendBtn.onclick();
        } else {
          try {
            voiceSession.recorder.stop();
          } catch (_) {}
        }
      } else if (holdDuration < HOLD_THRESHOLD) {
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
    
    // Проверяем, не движется ли палец над кнопкой flip camera
    const flipBtn = document.getElementById('voiceRecFlipCameraBtn');
    const touch = e.touches[0];
    if (flipBtn) {
      const rect = flipBtn.getBoundingClientRect();
      if (touch.clientX >= rect.left && touch.clientX <= rect.right &&
          touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
        return; // Не обрабатываем свайп если палец над flip camera
      }
    }
    
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
    // Проверяем, не был ли клик на кнопке flip camera (по позиции пальца)
    const flipBtn = document.getElementById('voiceRecFlipCameraBtn');
    const touch = e.changedTouches[0];
    if (flipBtn && touch) {
      const rect = flipBtn.getBoundingClientRect();
      if (touch.clientX >= rect.left && touch.clientX <= rect.right &&
          touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
        console.log('DEBUG: Touch ended on flipBtn area, skipping onRecordBtnUp');
        // Если палец поднят над кнопкой flip camera — не обрабатываем как отпускание recordBtn
        isHolding = false;
        startY = 0;
        currentY = 0;
        return;
      }
    }
    
    console.log('DEBUG: onTouchEnd calling onRecordBtnUp, isHolding:', isHolding);
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
