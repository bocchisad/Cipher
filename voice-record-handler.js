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
  let ignoreNextUp = false; // Блокировка onRecordBtnUp при клике на кнопки overlay
  
  const HOLD_THRESHOLD = 300; // минимум 300мс чтобы считать за долгое нажатие
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

    // CRITICAL: Добавляем pointer события для современных браузеров/устройств
    // Это предотвращает проблемы когда pointer события вызывают mouseup
    newBtn.addEventListener('pointerdown', onPointerDown);
    newBtn.addEventListener('pointerup', onPointerUp);
    newBtn.addEventListener('pointerleave', onPointerLeave);
    newBtn.addEventListener('pointercancel', onPointerUp);

    // Для мобильных устройств добавить touch события
    newBtn.addEventListener('touchstart', onTouchStart, { passive: false });
    newBtn.addEventListener('touchmove', onTouchMove, { passive: false });
    newBtn.addEventListener('touchend', onTouchEnd, { passive: false });
    newBtn.addEventListener('touchcancel', onTouchEnd, { passive: false });

    console.log('Record handler initialized (with swipe lock)');
  }

  // ==================== POINTER EVENTS ====================
  // Отдельные обработчики для pointer событий
  function onPointerDown(e) {
    // Если цель события - не recordBtn (например кнопка в overlay), игнорируем
    const recordBtn = document.getElementById('recordBtn');
    if (e.target !== recordBtn && !recordBtn.contains(e.target)) {
      return;
    }
    onRecordBtnDown(e);
  }

  function onPointerUp(e) {
    // Если цель события - не recordBtn, игнорируем полностью
    const recordBtn = document.getElementById('recordBtn');
    if (e.target !== recordBtn && !recordBtn.contains(e.target)) {
      console.log('🛡️ onPointerUp ignored: target is not recordBtn, target:', e.target.id || e.target.className);
      return;
    }
    onRecordBtnUp(e);
  }

  function onPointerLeave(e) {
    // Если цель события - не recordBtn, игнорируем
    const recordBtn = document.getElementById('recordBtn');
    if (e.target !== recordBtn && !recordBtn.contains(e.target)) {
      return;
    }
    onRecordBtnLeave(e);
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
    // Если событие не на recordBtn, игнорируем
    const recordBtn = document.getElementById('recordBtn');
    if (e && e.target && e.target !== recordBtn && !recordBtn.contains(e.target)) {
      return;
    }

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
    // CRITICAL FIX: Проверяем флаг блокировки (ставится при клике на кнопки overlay)
    if (ignoreNextUp) {
      console.log('🛡️ onRecordBtnUp blocked by ignoreNextUp flag');
      ignoreNextUp = false;
      isHolding = false;
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      return;
    }

    // CRITICAL FIX: Проверяем, что событие действительно произошло на кнопке записи,
    // а не всплыло/пропагировало с других элементов (например, кнопки flip camera)
    const recordBtn = document.getElementById('recordBtn');
    if (e && e.target && recordBtn && e.target !== recordBtn && !recordBtn.contains(e.target)) {
      console.log('🛡️ onRecordBtnUp ignored: event target is not recordBtn');
      return;
    }

    const holdDuration = Date.now() - holdStartTime;

    // Очистить таймер
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }

    // Проверяем, не был ли только что клик на flip camera (блокируем остановку записи)
    // Таймаут увеличен до 2000мс для надёжности на мобильных устройствах
    const justFlipped = typeof voiceSession !== 'undefined' && voiceSession &&
      voiceSession._justFlipped && (Date.now() - voiceSession._justFlipped) < 2000;
    
    // Если overlay активен и запись идет - не останавливаем запись (пользователь кликает на кнопки overlay)
    const overlayActive = document.getElementById('voiceRecordingOverlay')?.classList.contains('active');
    const isRecordingActive = typeof voiceSession !== 'undefined' && voiceSession && voiceSession.recorder &&
      (voiceSession.recorder.state === 'recording' || voiceSession.recorder.state === 'paused');
    
    if (overlayActive && isRecordingActive && !isLocked) {
      isHolding = false;
      // Удаляем UI свайпа
      if (typeof VoiceCirclesModule !== 'undefined' && VoiceCirclesModule.removeSwipeLockUI) {
        VoiceCirclesModule.removeSwipeLockUI();
      }
      return;
    }

    if (isHolding) {
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
        console.log('🔄 Toggle mode triggered. holdDuration:', holdDuration, 'THRESHOLD:', HOLD_THRESHOLD);
        console.log('🔄 VoiceCirclesModule exists?', typeof VoiceCirclesModule !== 'undefined');
        console.log('🔄 toggleCircleMode exists?', typeof VoiceCirclesModule?.toggleCircleMode === 'function');
        if (typeof VoiceCirclesModule !== 'undefined' && VoiceCirclesModule.toggleCircleMode) {
          console.log('🔄 Calling toggleCircleMode()');
          VoiceCirclesModule.toggleCircleMode();
        } else {
          console.error('❌ toggleCircleMode not available!');
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

  // Функция для блокировки следующего onRecordBtnUp (используется при клике на кнопки overlay)
  function setIgnoreNextUp(value) {
    ignoreNextUp = value;
    console.log('🛡️ ignoreNextUp set to:', value);
  }

  return {
    init,
    isRecordingLocked,
    setIgnoreNextUp
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
