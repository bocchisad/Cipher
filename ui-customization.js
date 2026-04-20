// ==================== UI CUSTOMIZATION MODULE ====================
// Полная кастомизация: фон, прозрачность панелей, цвета, градиенты

const UICustomizationModule = (() => {
  const STORAGE_KEY_PREFIX = 'cipherUI_';
  const DEFAULT_THEME = {
    bgImage: null,
    bgOpacity: 1,
    panelOpacity: 0.95,
    accentColor: '#4f8ef7',
    secondaryColor: '#3a7be8',
    textColor: '#e8eaf0',
    borderColor: '#2a2f3d',
    useAccentGradient: true,
    darkMode: true
  };

  let currentTheme = { ...DEFAULT_THEME };

  // ==================== ИНИЦИАЛИЗАЦИЯ ====================
  function init() {
    loadThemeFromStorage();
    // Ensure DOM is ready before applying theme
    if (document.body) {
      applyTheme();
    } else {
      // Wait for DOMContentLoaded if body not ready
      document.addEventListener('DOMContentLoaded', applyTheme, { once: true });
    }
    setupSettingsPanel();
  }

  // ==================== СОХРАНЕНИЕ И ЗАГРУЗКА ====================
  function loadThemeFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_PREFIX + 'theme');
      if (saved) {
        currentTheme = { ...DEFAULT_THEME, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.error('Failed to load theme:', e);
    }
  }

  function saveThemeToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY_PREFIX + 'theme', JSON.stringify(currentTheme));
    } catch (e) {
      console.error('Failed to save theme:', e);
    }
  }

  function applyTheme() {
    const root = document.documentElement;
    const body = document.body;

    // Фоновое изображение - используем фиксированный элемент для мобильной совместимости
    if (currentTheme.bgImage) {
      // Remove old background styles from root/body
      root.style.backgroundImage = '';
      body.style.backgroundImage = '';
      root.style.backgroundSize = '';
      body.style.backgroundSize = '';
      root.style.backgroundAttachment = '';
      body.style.backgroundAttachment = '';
      root.style.backgroundPosition = '';
      body.style.backgroundPosition = '';
      
      // Make body/html transparent so background shows through (use !important via CSSText for max priority)
      body.style.cssText = (body.style.cssText || '').replace(/background-color:\s*[^;]+;?/gi, '') + 'background-color: transparent !important;';
      root.style.cssText = (root.style.cssText || '').replace(/background-color:\s*[^;]+;?/gi, '') + 'background-color: transparent !important;';
      
      // Create or update fixed background element for mobile compatibility
      let bgElement = document.getElementById('cipherFixedBackground');
      if (!bgElement) {
        bgElement = document.createElement('div');
        bgElement.id = 'cipherFixedBackground';
        bgElement.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          z-index: -9999;
          pointer-events: none;
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
          background-attachment: fixed;
        `;
        document.body.insertBefore(bgElement, document.body.firstChild);
      }
      bgElement.style.backgroundImage = `url(${currentTheme.bgImage})`;
      
      // Add class to body to indicate background image is active
      document.body.classList.add('has-bg-image');
    } else {
      // Remove fixed background element
      const bgElement = document.getElementById('cipherFixedBackground');
      if (bgElement) bgElement.remove();
      
      // Remove background image class
      document.body.classList.remove('has-bg-image');
      
      // Restore default background colors
      const isDarkTheme = document.documentElement.dataset.theme === 'dark' || !document.documentElement.dataset.theme;
      const defaultColor = isDarkTheme ? '#0a0b0d' : '#e6e6e6';
      body.style.setProperty('background-color', defaultColor, 'important');
      root.style.setProperty('background-color', defaultColor, 'important');
      
      root.style.backgroundImage = '';
      body.style.backgroundImage = '';
    }

    // Прозрачность панелей - применяем ко ВСЕМ панелям
    applyPanelsTransparency();

    // Прозрачность фона - применяем только к фону (overlay)
    applyBackgroundTransparency();

    // Цвета
    updateCSSVariable('--accent', currentTheme.accentColor);
    updateCSSVariable('--accent2', currentTheme.secondaryColor);
    updateCSSVariable('--text', currentTheme.textColor);
    updateCSSVariable('--border', currentTheme.borderColor);

    // Обновить градиенты
    if (currentTheme.useAccentGradient) {
      updateCSSVariable('--accent-glow', `rgba(${hexToRgb(currentTheme.accentColor)},0.18)`);
    }

    // When background image is set, make main chat backgrounds transparent
    if (currentTheme.bgImage) {
      updateCSSVariable('--mainchat-bg', 'transparent');
      updateCSSVariable('--chat-thread-bg', 'transparent');
      updateCSSVariable('--messages-bg', 'transparent');
      updateCSSVariable('--welcome-bg', 'transparent');
      updateCSSVariable('--welcome-bg-opacity', 'transparent');
      
      // Directly set inline styles with !important for maximum priority
      const mainChat = document.getElementById('mainChat');
      const chatView = document.getElementById('chatView');
      const messagesArea = document.getElementById('messagesArea');
      const noChatView = document.getElementById('noChatView');
      const app = document.getElementById('app');
      
      if (mainChat) mainChat.style.setProperty('background', 'transparent', 'important');
      if (chatView) chatView.style.setProperty('background', 'transparent', 'important');
      if (messagesArea) messagesArea.style.setProperty('background', 'transparent', 'important');
      if (noChatView) noChatView.style.setProperty('background', 'transparent', 'important');
      if (app) app.style.setProperty('background', 'transparent', 'important');
    }

    saveThemeToStorage();
  }

  // Применить прозрачность ко ВСЕМ панелям через CSS переменные
  function applyPanelsTransparency() {
    const isDarkTheme = document.documentElement.dataset.theme === 'dark' || !document.documentElement.dataset.theme;
    
    // Определяем базовые цвета в зависимости от темы
    const baseBg = isDarkTheme ? '17, 19, 24' : '255, 255, 255';
    const panelOpacity = currentTheme.panelOpacity;
    
    // Создаем или обновляем стиль для применения прозрачности ко всем панелям
    let styleEl = document.getElementById('cipherPanelTransparency');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'cipherPanelTransparency';
      document.head.appendChild(styleEl);
    }
    
    // Применяем прозрачность ко всем панелям через CSS
    styleEl.textContent = `
      #sidebar { background: rgba(${baseBg}, ${panelOpacity}) !important; }
      #chatList { background: rgba(${baseBg}, ${panelOpacity}) !important; }
      #inputArea { background: rgba(${baseBg}, ${panelOpacity}) !important; }
      #chatHeader { background: rgba(${baseBg}, ${panelOpacity}) !important; }
      #infoPanel { background: rgba(${baseBg}, ${panelOpacity}) !important; }
      .ui-customization-panel { background: rgba(${baseBg}, ${panelOpacity}) !important; }
      .custom-panel-header { background: rgba(${baseBg}, ${panelOpacity}) !important; }
    `;
    
    // Также обновляем CSS переменные для совместимости
    updateCSSVariable('--sidebar-bg', `rgba(${baseBg}, ${panelOpacity})`);
    updateCSSVariable('--chatlist-bg', `rgba(${baseBg}, ${panelOpacity})`);
    updateCSSVariable('--input-bg', `rgba(${baseBg}, ${panelOpacity})`);
    
    // Добавляем класс для blur эффекта если прозрачность < 1
    const root = document.documentElement;
    if (panelOpacity < 1) {
      root.classList.add('panels-transparent');
    } else {
      root.classList.remove('panels-transparent');
    }
    
    // When background image is set, make main chat areas transparent to show background
    if (currentTheme.bgImage) {
      styleEl.textContent += `
        body, html { background-color: transparent !important; }
        #app { background: transparent !important; }
        #mainChat { background: transparent !important; }
        #noChatView { background: transparent !important; }
        #chatView { background: transparent !important; }
        #messagesArea { background: transparent !important; }
        .chat-empty { background: transparent !important; }
        #noChatView .nc-logo, #noChatView p { display: none !important; }
        /* Force transparent backgrounds for both themes */
        :root[data-theme="dark"] #mainChat,
        :root[data-theme="light"] #mainChat { background: transparent !important; }
        :root[data-theme="dark"] #chatView,
        :root[data-theme="light"] #chatView { background: transparent !important; }
        :root[data-theme="dark"] #messagesArea,
        :root[data-theme="light"] #messagesArea { background: transparent !important; }
      `;
    }
  }

  // Применить прозрачность ТОЛЬКО к фону через CSS переменные
  function applyBackgroundTransparency() {
    const bgOpacity = currentTheme.bgOpacity;
    const isDarkTheme = document.documentElement.dataset.theme === 'dark' || !document.documentElement.dataset.theme;
    
    // Цвет фона чата с учетом прозрачности
    const baseChatBg = isDarkTheme ? '10, 11, 13' : '232, 236, 243';
    
    // Обновляем CSS переменные для фона
    updateCSSVariable('--chat-thread-bg', `rgba(${baseChatBg}, ${bgOpacity})`);
    updateCSSVariable('--mainchat-bg', `rgba(${baseChatBg}, ${bgOpacity})`);
    updateCSSVariable('--messages-bg', `rgba(${baseChatBg}, ${bgOpacity * 0.8})`);
    // Фон главного экрана (когда чат не выбран)
    updateCSSVariable('--welcome-bg-opacity', `rgba(${baseChatBg}, ${bgOpacity * 0.05})`);
    
    // Обновляем оверлей если есть фоновое изображение
    if (currentTheme.bgImage) {
      const overlay = document.getElementById('bgOverlay') || createBackgroundOverlay();
      // Инвертируем логику: при низкой прозрачности фона оверлей темнее
      const overlayOpacity = Math.max(0, 0.6 - (bgOpacity * 0.5));
      overlay.style.opacity = overlayOpacity;
      overlay.style.background = isDarkTheme 
        ? `rgba(0, 0, 0, ${overlayOpacity})` 
        : `rgba(255, 255, 255, ${overlayOpacity})`;
    }
  }

  // ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================
  function updateCSSVariable(name, value) {
    document.documentElement.style.setProperty(name, value);
  }

  function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result 
      ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
      : '79, 142, 247';
  }

  function adjustColorOpacity(color, opacity) {
    // Преобразовать hex в rgba
    const [r, g, b] = [(color.substring(1, 3)), (color.substring(3, 5)), (color.substring(5, 7))];
    return `rgba(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}, ${opacity})`;
  }

  function createBackgroundOverlay() {
    let overlay = document.getElementById('bgOverlay');
    if (overlay) return overlay;
    
    overlay = document.createElement('div');
    overlay.id = 'bgOverlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(10, 11, 13, 0.3);
      pointer-events: none;
      z-index: -1;
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  // ==================== ПАНЕЛЬ НАСТРОЕК ====================
  function setupSettingsPanel() {
    const settingsBtn = document.getElementById('customizeUIBtn');
    if (!settingsBtn) {
      console.warn('UI CustomizeUI button not found');
      return;
    }

    settingsBtn.addEventListener('click', openCustomizationPanel);
  }

  function openCustomizationPanel() {
    // Закрыть все другие модали
    const settingsModal = document.getElementById('settingsModal');
    if (settingsModal && settingsModal.style.display !== 'none') {
      settingsModal.style.display = 'none';
    }
    const roomSettingsModal = document.getElementById('roomSettingsModal');
    if (roomSettingsModal && roomSettingsModal.style.display !== 'none') {
      roomSettingsModal.style.display = 'none';
    }
    
    const panel = document.getElementById('uiCustomizationPanel') || createCustomizationPanel();
    const backdrop = document.getElementById('uiCustomizationBackdrop');
    
    const isActive = panel.classList.contains('active');
    if (isActive) {
      panel.classList.remove('active');
      if (backdrop) backdrop.classList.remove('active');
    } else {
      panel.classList.add('active');
      if (backdrop) backdrop.classList.add('active');
    }
  }

  function createCustomizationPanel() {
    const panel = document.createElement('div');
    panel.id = 'uiCustomizationPanel';
    panel.className = 'ui-customization-panel';
    panel.innerHTML = `
      <div class="custom-panel-header">
        <h3>🎨 Кастомизация интерфейса</h3>
        <button type="button" class="close-btn" onclick="UICustomizationModule.closePanel()">×</button>
      </div>

      <div class="custom-panel-content">
        <!-- ФОНОВОЕ ИЗОБРАЖЕНИЕ -->
        <div class="custom-section">
          <label>📸 Фоновое изображение</label>
          <div style="display: flex; gap: 8px;">
            <input type="file" id="bgImageInput" accept="image/*" style="flex: 1; font-size: 12px;">
            <button type="button" class="btn-ghost" onclick="UICustomizationModule.clearBackground()">Очистить</button>
          </div>
          <div id="bgImagePreview" style="margin-top: 8px; width: 100%; height: 80px; border-radius: 8px; background: var(--bg3); overflow: hidden; border: 1px solid var(--border);">
          </div>
        </div>

        <!-- ПРОЗРАЧНОСТЬ ФОНА -->
        <div class="custom-section">
          <label>🌫️ Прозрачность фона чата</label>
          <div style="display: flex; gap: 10px; align-items: center;">
            <input type="range" id="bgOpacitySlider" min="0" max="1" step="0.1" value="${currentTheme.bgOpacity}" style="flex: 1;">
            <span id="bgOpacityValue" style="width: 35px; text-align: center;">${(currentTheme.bgOpacity * 100).toFixed(0)}%</span>
          </div>
        </div>

        <!-- ПРОЗРАЧНОСТЬ ПАНЕЛЕЙ -->
        <div class="custom-section">
          <label>💠 Прозрачность всех панелей</label>
          <div style="display: flex; gap: 10px; align-items: center;">
            <input type="range" id="panelOpacitySlider" min="0.3" max="1" step="0.05" value="${currentTheme.panelOpacity}" style="flex: 1;">
            <span id="panelOpacityValue" style="width: 35px; text-align: center;">${(currentTheme.panelOpacity * 100).toFixed(0)}%</span>
          </div>
        </div>

        <!-- ОСНОВНОЙ ЦВЕТ (ACCENT) -->
        <div class="custom-section">
          <label>🎯 Основной цвет (Accent)</label>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="color" id="accentColorPicker" value="${currentTheme.accentColor}" style="width: 50px; height: 40px; cursor: pointer; border: none; border-radius: 8px;">
            <input type="text" id="accentColorText" value="${currentTheme.accentColor}" style="flex: 1; padding: 8px; border: 1px solid var(--border); border-radius: 8px; font-family: monospace; font-size: 12px;">
          </div>
        </div>

        <!-- ВТОРИЧНЫЙ ЦВЕТ -->
        <div class="custom-section">
          <label>🎨 Вторичный цвет</label>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="color" id="secondaryColorPicker" value="${currentTheme.secondaryColor}" style="width: 50px; height: 40px; cursor: pointer; border: none; border-radius: 8px;">
            <input type="text" id="secondaryColorText" value="${currentTheme.secondaryColor}" style="flex: 1; padding: 8px; border: 1px solid var(--border); border-radius: 8px; font-family: monospace; font-size: 12px;">
          </div>
        </div>

        <!-- ЦВЕТ ТЕКСТА -->
        <div class="custom-section">
          <label>📝 Цвет текста</label>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="color" id="textColorPicker" value="${currentTheme.textColor}" style="width: 50px; height: 40px; cursor: pointer; border: none; border-radius: 8px;">
            <input type="text" id="textColorText" value="${currentTheme.textColor}" style="flex: 1; padding: 8px; border: 1px solid var(--border); border-radius: 8px; font-family: monospace; font-size: 12px;">
          </div>
        </div>

        <!-- ЦВЕТ ГРАНИЦ -->
        <div class="custom-section">
          <label>📐 Цвет границ</label>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="color" id="borderColorPicker" value="${currentTheme.borderColor}" style="width: 50px; height: 40px; cursor: pointer; border: none; border-radius: 8px;">
            <input type="text" id="borderColorText" value="${currentTheme.borderColor}" style="flex: 1; padding: 8px; border: 1px solid var(--border); border-radius: 8px; font-family: monospace; font-size: 12px;">
          </div>
        </div>

        <!-- КНОПКИ -->
        <div class="custom-section" style="display: flex; gap: 8px;">
          <button type="button" class="btn-ghost" onclick="UICustomizationModule.resetToDefaults()" style="flex: 1;">↺ По умолчанию</button>
        </div>
      </div>
    `;

    // Стили панели
    const style = document.createElement('style');
    style.textContent = `
      .ui-customization-panel {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: var(--bg2);
        border: 1px solid var(--border);
        border-radius: 16px;
        max-width: 480px;
        width: 90vw;
        max-height: 90vh;
        overflow-y: auto;
        z-index: 9999;
        box-shadow: 0 20px 80px rgba(0, 0, 0, 0.5);
        display: none;
      }
      
      .ui-customization-panel.active {
        display: block;
      }
      // Backdrop overlay - просывается раньше
      .ui-customization-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.6);
        z-index: 9998;
        display: none;
        cursor: pointer;
      }
      
      .ui-customization-backdrop.active {
        display: block;
      }

      .custom-panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px;
        border-bottom: 1px solid var(--border);
        position: sticky;
        top: 0;
        background: var(--bg2);
        z-index: 10000;
      }

      .custom-panel-header h3 {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
      }

      .custom-panel-header .close-btn {
        background: none;
        border: none;
        font-size: 24px;
        color: var(--text2);
        cursor: pointer;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        transition: all 0.2s;
      }

      .custom-panel-header .close-btn:hover {
        background: var(--bg3);
        color: var(--text);
      }

      .custom-panel-content {
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .custom-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .custom-section label {
        font-size: 13px;
        font-weight: 600;
        color: var(--text);
      }

      .custom-section input[type="range"] {
        width: 100%;
        cursor: pointer;
      }

      .custom-section input[type="file"] {
        padding: 8px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--bg3);
        color: var(--text2);
        font-size: 12px;
      }

      .btn-ghost {
        padding: 8px 12px;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: transparent;
        color: var(--text2);
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s;
      }

      .btn-ghost:hover {
        background: var(--bg3);
        color: var(--text);
        border-color: var(--accent);
      }
    `;

    if (!document.querySelector('style[data-customization]')) {
      style.setAttribute('data-customization', 'true');
      document.head.appendChild(style);
    }

    document.body.appendChild(panel);

    // Создать backdrop overlay
    let backdrop = document.getElementById('uiCustomizationBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'uiCustomizationBackdrop';
      backdrop.className = 'ui-customization-backdrop';
      backdrop.addEventListener('click', () => {
        panel.classList.remove('active');
        backdrop.classList.remove('active');
      });
      document.body.appendChild(backdrop);
    }

    // Закрытие при клике на фон (внутри панели)
    panel.addEventListener('click', (e) => {
      if (e.target === panel) {
        panel.classList.remove('active');
        backdrop.classList.remove('active');
      }
    });

    // Обновить openCustomizationPanel чтобы управлять классами
    const originalOpen = window.UICustomizationModule?.openCustomizationPanel;
    
    // Стандартное закрытие по X кнопке
    const closeBtn = panel.querySelector('.close-btn');
    if (closeBtn) {
      closeBtn.onclick = () => {
        panel.classList.remove('active');
        if (backdrop) backdrop.classList.remove('active');
      };
    }

    // Обработчики событий
    setupCustomizationEventListeners();
    
    // Закытие при клике на бакдроп
    if (backdrop) {
      backdrop.onclick = () => {
        panel.classList.remove('active');
        backdrop.classList.remove('active');
      };
    }
    
    // Предотвратить закрытие при клике на панель
    panel.onclick = (e) => {
      if (e.target === panel) {
        panel.classList.remove('active');
        if (backdrop) backdrop.classList.remove('active');
      }
    };
    
    // Закытие по Escape
    const closeOnEscape = (e) => {
      if (e.key === 'Escape' && panel.classList.contains('active')) {
        panel.classList.remove('active');
        if (backdrop) backdrop.classList.remove('active');
        document.removeEventListener('keydown', closeOnEscape);
      }
    };
    document.addEventListener('keydown', closeOnEscape);

    return panel;
  }

  function setupCustomizationEventListeners() {
    // Загрузка фонового изображения
    const bgImageInput = document.getElementById('bgImageInput');
    if (bgImageInput) {
      bgImageInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            currentTheme.bgImage = evt.target?.result;
            applyTheme();
            updateBackgroundPreview();
          };
          reader.readAsDataURL(file);
        }
      });
    }

    // Прозрачность фона - применяется только к фону чата
    const bgOpacitySlider = document.getElementById('bgOpacitySlider');
    if (bgOpacitySlider) {
      bgOpacitySlider.addEventListener('input', (e) => {
        currentTheme.bgOpacity = parseFloat(e.target.value);
        document.getElementById('bgOpacityValue').textContent = `${(currentTheme.bgOpacity * 100).toFixed(0)}%`;
        applyTheme();
      });
    }

    // Прозрачность панелей - применяется ко ВСЕМ панелям
    const panelOpacitySlider = document.getElementById('panelOpacitySlider');
    if (panelOpacitySlider) {
      panelOpacitySlider.addEventListener('input', (e) => {
        currentTheme.panelOpacity = parseFloat(e.target.value);
        document.getElementById('panelOpacityValue').textContent = `${(currentTheme.panelOpacity * 100).toFixed(0)}%`;
        applyTheme();
      });
    }

    // Цвета
    ['accent', 'secondary', 'text', 'border'].forEach(colorType => {
      const pickerName = colorType === 'secondary' ? 'secondaryColorPicker' : `${colorType}ColorPicker`;
      const textName = colorType === 'secondary' ? 'secondaryColorText' : `${colorType}ColorText`;
      const themeKey = colorType === 'secondary' ? 'secondaryColor' : `${colorType}Color`;

      const picker = document.getElementById(pickerName);
      const textInput = document.getElementById(textName);

      if (picker) picker.addEventListener('change', (e) => {
          currentTheme[themeKey] = e.target.value;
          if (textInput) textInput.value = e.target.value;
          applyTheme();
        });

      if (textInput) textInput.addEventListener('change', (e) => {
          if (/^#[0-9A-F]{6}$/i.test(e.target.value)) {
            currentTheme[themeKey] = e.target.value;
            if (picker) picker.value = e.target.value;
            applyTheme();
          }
        });
    });
  }

  function updateBackgroundPreview() {
    const preview = document.getElementById('bgImagePreview');
    if (!preview) return;
    preview.style.backgroundImage = currentTheme.bgImage ? `url(${currentTheme.bgImage})` : 'none';
    preview.style.backgroundSize = 'cover';
    preview.style.backgroundPosition = 'center';
  }

  function resetToDefaults() {
    if (confirm('Сбросить все настройки на значения по умолчанию?')) {
      currentTheme = { ...DEFAULT_THEME };
      applyTheme();
      location.reload();
    }
  }

  function clearBackground() {
    currentTheme.bgImage = null;
    applyTheme();
    const preview = document.getElementById('bgImagePreview');
    if (preview) preview.style.backgroundImage = 'none';
    const input = document.getElementById('bgImageInput');
    if (input) input.value = '';
  }

  function closePanel() {
    const panel = document.getElementById('uiCustomizationPanel');
    const backdrop = document.getElementById('uiCustomizationBackdrop');
    if (panel) panel.classList.remove('active');
    if (backdrop) backdrop.classList.remove('active');
  }

  function closePanel() {
    const panel = document.getElementById('uiCustomizationPanel');
    const backdrop = document.getElementById('uiCustomizationBackdrop');
    if (panel) panel.classList.remove('active');
    if (backdrop) backdrop.classList.remove('active');
  }
  return {
    init,
    loadThemeFromStorage,
    saveThemeToStorage,
    applyTheme,
    closePanel,
    openCustomizationPanel,
    resetToDefaults,
    clearBackground,
    set: (key, value) => {
      if (key in currentTheme) {
        currentTheme[key] = value;
        applyTheme();
      }
    },
    get: (key) => currentTheme[key],
    getTheme: () => ({ ...currentTheme })
  };
})();

// Инициализация при загрузке
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => UICustomizationModule.init());
} else {
  UICustomizationModule.init();
}
