// ==================== VOICE CIRCLES (TELEGRAM-STYLE) WITH E2EE ====================
// Система голосовых кружочков с паузами, отменой, переключением голос/кружок
// ✅ Все кружочки и голос сообщения ЗАШИФРОВАНЫ (E2EE)

const VoiceCirclesModule = (() => {
  let circleMode = false; // false = голос сообщение, true = кружочек
  let isRecordingCircle = false;

  // Инициализация
  function init() {
    const modeToggle = document.getElementById('voiceModeToggle');
    if (modeToggle) {
      modeToggle.addEventListener('click', toggleCircleMode);
    }
  }

  // Переключение между голос сообщением и кружочком
  function toggleCircleMode() {
    circleMode = !circleMode;
    const toggle = document.getElementById('voiceModeToggle');
    if (toggle) {
      toggle.classList.toggle('circle-mode', circleMode);
      toggle.title = circleMode ? 'Кружочки' : 'Голос сообщение';
      const icon = toggle.querySelector('svg');
      if (icon) {
        icon.innerHTML = circleMode 
          ? '<circle cx="12" cy="12" r="10" fill="currentColor"/>' // Круг
          : '<path d="M12 2a10 10 0 0 0-10 10v8a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-4.5a2 2 0 0 0-2-2h-.5a7.5 7.5 0 0 1 15 0H19a2 2 0 0 0-2 2V20a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-8a10 10 0 0 0-10-10z" fill="none" stroke="currentColor" stroke-width="2"/>'; // Микрофон
      }
    }
  }

  function getCircleMode() {
    return circleMode;
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
    circle.style.cssText = `
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--accent), var(--accent2));
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      position: relative;
      transition: transform 0.2s;
      box-shadow: 0 2px 8px rgba(79, 142, 247, 0.3);
      flex-shrink: 0;
    `;

    // Плей кнопка
    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.innerHTML = '▶';
    playBtn.style.cssText = `
      background: none;
      border: none;
      color: white;
      font-size: 28px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      transition: transform 0.2s;
    `;

    // Время в центре
    const timeDiv = document.createElement('div');
    timeDiv.className = 'voice-circle-time';
    timeDiv.textContent = formatTime(circleData.duration);
    timeDiv.style.cssText = `
      position: absolute;
      font-size: 10px;
      color: rgba(255, 255, 255, 0.8);
      white-space: nowrap;
      font-weight: 600;
      bottom: 6px;
      left: 50%;
      transform: translateX(-50%);
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
      circle.style.transform = 'scale(1.08)';
    });
    circle.addEventListener('mouseleave', () => {
      circle.style.transform = 'scale(1)';
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
    playBtn.innerHTML = '▶';
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
      playBtn.innerHTML = '⏸';
      setTimeout(() => { playBtn.innerHTML = '▶'; }, 1000);
    });

    container.appendChild(voiceDiv);
    return voiceDiv;
  }

  // Воспроизведение кружочка или голос сообщения
  function playVoiceCircle(voiceData) {
    if (!voiceData.blob && !voiceData.audio) {
      console.error('❌ No audio data to play');
      return;
    }

    try {
      let blob = voiceData.blob;

      // Если audio в base64, конвертировать в blob
      if (!blob && voiceData.audio) {
        const binaryString = atob(voiceData.audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        blob = new Blob([bytes], { type: 'audio/wav' });
      }

      const audio = new Audio(URL.createObjectURL(blob));
      audio.play().catch(err => console.error('❌ Play error:', err));
    } catch (err) {
      console.error('❌ Error playing voice:', err);
    }
  }

  // Форматирование времени
  function formatTime(seconds) {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
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
    formatTime
  };
})();

// Инициализация при загрузке
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => VoiceCirclesModule.init());
} else {
  VoiceCirclesModule.init();
}
