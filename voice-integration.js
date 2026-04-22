// ==================== VOICE CIRCLES INTEGRATION ====================
// Интеграция VoiceCirclesModule с существующей системой записи голоса
// Подключается после VoiceCirclesModule и UI-CustomizationModule

const VoiceIntegrationModule = (() => {
  let integrationReady = false;

  function init() {
    // Ждем загрузки основных модулей
    if (typeof VoiceCirclesModule === 'undefined') {
      console.warn('⚠️ VoiceCirclesModule not loaded yet, retrying...');
      setTimeout(init, 500);
      return;
    }

    integrationReady = true;
    wireSendVoiceHandler();
    console.log('✅ Voice Integration Module loaded');
  }

  // ==================== ПЕРЕХВАТ ОТПРАВКИ ГОЛОСА ====================
  function wireSendVoiceHandler() {
    // Перехватываем исходную sendMessage для обработки голоса
    const originalSendMessage = window.sendMessage;
    if (!originalSendMessage) {
      console.warn('⚠️ sendMessage not found, retrying...');
      setTimeout(wireSendVoiceHandler, 500);
      return;
    }

    window.sendMessage = async function(type, content, options = {}) {
      // Если это не голос, используем оригинальную функцию
      if (type !== 'voice') {
        return originalSendMessage.call(this, type, content, options);
      }

      // ======== СПЕЦИАЛЬНАЯ ОБРАБОТКА ГОЛОСА ========
      try {
        const isCircle = VoiceCirclesModule.getCircleMode();
        const targetChat = options.toGroupId || window.activeChat;

        if (!targetChat) {
          console.error('❌ No target chat selected');
          return;
        }

        // Пометить тип голоса в content
        const voiceContent = {
          ...content,
          isCircle: isCircle, // true = кружочек, false = голос сообщение
          timestamp: Date.now()
        };

        console.log(`🎙️ Sending voice message (${isCircle ? 'circle' : 'message'}), duration: ${content.duration}s`);

        // Вызываем оригинальную функцию с дополненными данными
        return originalSendMessage.call(this, type, voiceContent, options);
      } catch (err) {
        console.error('❌ Error in voice integration:', err);
        showToast('Ошибка при отправке голосового сообщения');
      }
    };

    console.log('✅ Voice send handler wired');
  }

  // ==================== ОБРАБОТЧИК ПОЛУЧЕНИЯ ГОЛОСА ====================
  // Интегрируется с обработчиком входящих сообщений
  function processIncomingVoiceMessage(message, senderUuid) {
    try {
      if (!message || message.type !== 'voice') return;

      const isCircle = message.content?.isCircle;
      const duration = message.content?.duration || 0;

      console.log(`🎙️ Received voice message (${isCircle ? 'circle' : 'message'}), from: ${senderUuid}, duration: ${duration}s`);

      // Если есть шифрованные данные, расшифровать
      if (message.encrypted && typeof VoiceCirclesModule.decryptVoiceData === 'function') {
        VoiceCirclesModule.decryptVoiceData(message, senderUuid, message.roomId)
          .then(decrypted => {
            if (decrypted) {
              console.log('✅ Voice message decrypted successfully');
              message.content = decrypted;
            }
          })
          .catch(err => console.error('❌ Failed to decrypt voice message:', err));
      }

      // Добавить кружочек в профайл если это кружочек
      if (isCircle && typeof VoiceCirclesModule.addCircleToProfile === 'function') {
        VoiceCirclesModule.addCircleToProfile(senderUuid, {
          audio: message.content?.data,
          duration: duration
        });
      }
    } catch (err) {
      console.error('❌ Error processing incoming voice message:', err);
    }
  }

  // ==================== ОТОБРАЖЕНИЕ ГОЛОСА ====================
  // Оборачивает отображение голосового сообщения
  function renderVoiceMessage(messageElement, message) {
    try {
      if (!messageElement || message.type !== 'voice') return;

      const isCircle = message.content?.isCircle;
      const duration = message.content?.duration || 0;

      // Найти контейнер для контента
      const content = messageElement.querySelector('[data-msg-content]') || messageElement;
      if (!content) return;

      // Очистить старый контент
      content.innerHTML = '';

      if (isCircle) {
        // Отобразить кружочек
        if (typeof VoiceCirclesModule.renderVoiceCircle === 'function') {
          VoiceCirclesModule.renderVoiceCircle(content, {
            blob: message.content?.blob,
            audio: message.content?.data,
            duration: duration,
            isCircle: true,
            isVideo: message.content?.isVideo || false,
            facingMode: message.content?.facingMode || 'user'
          });
        }
      } else {
        // Отобразить голос сообщение
        if (typeof VoiceCirclesModule.renderVoiceMessage === 'function') {
          VoiceCirclesModule.renderVoiceMessage(content, {
            blob: message.content?.blob,
            audio: message.content?.data,
            duration: duration,
            isCircle: false,
            isVideo: message.content?.isVideo || false,
            facingMode: message.content?.facingMode || 'user'
          });
        }
      }
    } catch (err) {
      console.error('❌ Error rendering voice message:', err);
    }
  }

  // ==================== ПЕРЕХВАТ ПЕРЕКЛЮЧЕНИЯ РЕЖИМА ====================
  // Добавляет визуальное отображение текущего режима
  function updateVoiceModeIndicator() {
    const btn = document.getElementById('voiceModeToggle');
    if (!btn) return;

    const isCircle = VoiceCirclesModule.getCircleMode();
    btn.classList.toggle('circle-mode', isCircle);
    btn.title = isCircle 
      ? '📢 Кружочки (активны) / Нажмите для голос сообщений'
      : '🎤 Голос сообщения (активны) / Нажмите для кружочков';

    // Обновить стиль кнопки
    if (isCircle) {
      btn.style.color = 'var(--accent)';
    } else {
      btn.style.color = 'inherit';
    }
  }

  // Слушающий обработчик для переключения режима
  function wireVoiceModeToggle() {
    const btn = document.getElementById('voiceModeToggle');
    if (!btn) return;

    // Переопределить обработчик если нужно добавить визуализацию
    const originalOnClick = btn.onclick;
    btn.onclick = function(e) {
      if (originalOnClick) originalOnClick.call(this, e);
      setTimeout(updateVoiceModeIndicator, 50);
    };

    updateVoiceModeIndicator();
  }

  // ==================== PUBLIC API ====================
  return {
    init,
    processIncomingVoiceMessage,
    renderVoiceMessage,
    updateVoiceModeIndicator,
    wireVoiceModeToggle,
    isReady: () => integrationReady
  };
})();

// Инициализация
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => VoiceIntegrationModule.init(), 500);
  });
} else {
  setTimeout(() => VoiceIntegrationModule.init(), 500);
}
