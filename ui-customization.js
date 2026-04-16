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
    applyTheme();
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

  // ==================== ПРИМЕНЕНИЕ ТЕМЫ ====================
  function applyTheme() {
    const root = document.documentElement;
    const body = document.body;

    // Фоновое изображение - применить к body и html
    if (currentTheme.bgImage) {
      root.style.backgroundImage = `url(${currentTheme.bgImage})`;
      body.style.backgroundImage = `url(${currentTheme.bgImage})`;
      root.style.backgroundSize = 'cover';
      body.style.backgroundSize = 'cover';
      root.style.backgroundAttachment = 'fixed';
      body.style.backgroundAttachment = 'fixed';
      root.style.backgroundPosition = 'center';
      body.style.backgroundPosition = 'center';
    } else {
      root.style.backgroundImage = 'none';
      body.style.backgroundImage = 'none';
    }

    // Основной фон с прозрачностью
    updateCSSVariable('--bg0', adjustColorOpacity('#0a0b0d', currentTheme.bgOpacity));
    updateCSSVariable('--bg1', adjustColorOpacity('#111318', currentTheme.panelOpacity));
    updateCSSVariable('--bg2', adjustColorOpacity('#181b22', currentTheme.panelOpacity));
    updateCSSVariable('--bg3', adjustColorOpacity('#1f232d', currentTheme.panelOpacity));
    updateCSSVariable('--bg4', adjustColorOpacity('#252a36', currentTheme.panelOpacity));

    // Цвета
    updateCSSVariable('--accent', currentTheme.accentColor);
    updateCSSVariable('--accent2', currentTheme.secondaryColor);
    updateCSSVariable('--text', currentTheme.textColor);
    updateCSSVariable('--border', currentTheme.borderColor);

    // Обновить граненты
    if (currentTheme.useAccentGradient) {
      updateCSSVariable('--accent-glow', `rgba(${hexToRgb(currentTheme.accentColor)},0.18)`);
    }

    // Применить фильтр к фону если есть бэкграунд
    if (currentTheme.bgImage) {
      applyBackgroundOverlay();
    }

    saveThemeToStorage();
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

  function applyBackgroundOverlay() {
    // Добавить темный оверлей поверх фона для улучшения читаемости
    const overlay = document.getElementById('bgOverlay') || createBackgroundOverlay();
    const overlayOpacity = Math.max(0, 0.3 - (currentTheme.bgOpacity * 0.1));
    overlay.style.opacity = overlayOpacity;
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
    const panel = document.getElementById('uiCustomizationPanel') || createCustomizationPanel();
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
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
          <label>🌫️ Прозрачность фона</label>
          <div style="display: flex; gap: 10px; align-items: center;">
            <input type="range" id="bgOpacitySlider" min="0" max="1" step="0.1" value="${currentTheme.bgOpacity}" style="flex: 1;">
            <span id="bgOpacityValue" style="width: 35px; text-align: center;">${(currentTheme.bgOpacity * 100).toFixed(0)}%</span>
          </div>
        </div>

        <!-- ПРОЗРАЧНОСТЬ ПАНЕЛЕЙ -->
        <div class="custom-section">
          <label>💠 Прозрачность панелей</label>
          <div style="display: flex; gap: 10px; align-items: center;">
            <input type="range" id="panelOpacitySlider" min="0.5" max="1" step="0.05" value="${currentTheme.panelOpacity}" style="flex: 1;">
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

      .custom-panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px;
        border-bottom: 1px solid var(--border);
        position: sticky;
        top: 0;
        background: var(--bg2);
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

    // Обработчики событий
    setupCustomizationEventListeners();

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

    // Прозрачность фона
    const bgOpacitySlider = document.getElementById('bgOpacitySlider');
    if (bgOpacitySlider) {
      bgOpacitySlider.addEventListener('input', (e) => {
        currentTheme.bgOpacity = parseFloat(e.target.value);
        document.getElementById('bgOpacityValue').textContent = `${(currentTheme.bgOpacity * 100).toFixed(0)}%`;
        applyTheme();
      });
    }

    // Прозрачность панелей
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
    if (panel) panel.style.display = 'none';
  }

  return {
    init,
    openCustomizationPanel,
    closePanel,
    applyTheme,
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
