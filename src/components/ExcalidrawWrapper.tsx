import { useEffect, useRef, useCallback, useState } from 'react';
import '@excalidraw/excalidraw/index.css';

export default function ExcalidrawWrapper() {
  const containerRef = useRef(null);
  const fileIdRef = useRef(null);
  const timerRef = useRef(null);
  const autoSaveRef = useRef(false);
  const queuedLoadRef = useRef(null);
  const skipDirtyRef = useRef(false);
  const lastSavedDataRef = useRef(null);
  const [ExcalidrawComp, setExcalidrawComp] = useState(null);
  const [theme, setTheme] = useState('light');
  const excRef = useRef(null);

  useEffect(() => {
    import('@excalidraw/excalidraw').then(mod => {
      setExcalidrawComp(() => mod.Excalidraw);
    });
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('yooexcalidraw_settings');
      if (raw) {
        const s = JSON.parse(raw);
        autoSaveRef.current = s.autoSave === true;
        const effective = s.theme === 'auto'
          ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
          : s.theme;
        if (effective === 'light' || effective === 'dark') setTheme(effective);
      }
    } catch (e) {}

    function handleThemeChange(e) {
      const t = e.detail.theme;
      if (t === 'light' || t === 'dark') setTheme(t);
    }

    function handleSettingsChange(e) {
      autoSaveRef.current = e.detail.autoSave === true;
    }

    window.addEventListener('excalidraw:theme-changed', handleThemeChange);
    window.addEventListener('excalidraw:settings-changed', handleSettingsChange);

    return () => {
      window.removeEventListener('excalidraw:theme-changed', handleThemeChange);
      window.removeEventListener('excalidraw:settings-changed', handleSettingsChange);
    };
  }, []);

  const loadScene = useCallback(function(fileId, sceneData) {
    fileIdRef.current = fileId;
    if (!excRef.current || !sceneData) {
      if (sceneData) queuedLoadRef.current = { fileId, sceneData };
      return;
    }
    skipDirtyRef.current = true;
    try {
      if (sceneData.files) {
        var fileArray = Object.values(sceneData.files);
        if (fileArray.length > 0) {
          excRef.current.addFiles(fileArray);
        }
      }
      var appStateUpdate = sceneData.appState ? {
        ...(sceneData.appState.viewBackgroundColor != null ? { viewBackgroundColor: sceneData.appState.viewBackgroundColor } : {}),
        ...(sceneData.appState.gridSize != null ? { gridSize: sceneData.appState.gridSize } : {}),
      } : undefined;
      var normalizedElements = (sceneData.elements || []).map(function(el) {
        if (!el) return el;
        if (el.type === 'line' || el.type === 'arrow' || el.type === 'draw') {
          if (!Array.isArray(el.points) || el.points.length < 2) {
            var w = el.width || 0;
            var h = el.height || 0;
            return { ...el, points: [[0, 0], [w, h]] };
          }
        }
        return el;
      });
      excRef.current.updateScene({ elements: [] });
      excRef.current.updateScene({
        elements: normalizedElements,
        ...(appStateUpdate ? { appState: appStateUpdate } : {}),
      });
    } catch (err) {
      console.warn('[ExcalidrawWrapper] loadScene failed:', err);
    }
    lastSavedDataRef.current = JSON.stringify({
      elements: normalizedElements,
      appState: {
        ...(sceneData.appState && sceneData.appState.viewBackgroundColor != null ? { viewBackgroundColor: sceneData.appState.viewBackgroundColor } : {}),
        ...(sceneData.appState && sceneData.appState.gridSize != null ? { gridSize: sceneData.appState.gridSize } : {}),
      },
      files: sceneData.files || {},
    });
    setTimeout(function() { skipDirtyRef.current = false; }, 0);
  }, []);

  const doSave = useCallback((fileId, sceneData, immediate) => {
    window.dispatchEvent(new CustomEvent('excalidraw:autosave', {
      detail: { fileId, sceneData, immediate },
    }));
  }, []);

  const onChange = useCallback((elements, appState, files) => {
    if (!fileIdRef.current) return;
    if (skipDirtyRef.current) return;
    const filteredAppState = {
      ...(appState.viewBackgroundColor != null ? { viewBackgroundColor: appState.viewBackgroundColor } : {}),
      ...(appState.gridSize != null ? { gridSize: appState.gridSize } : {}),
    };
    const data = JSON.stringify({ elements, appState: filteredAppState, files });
    if (data === lastSavedDataRef.current) return;
    window.dispatchEvent(new CustomEvent('excalidraw:dirty'));
    if (!autoSaveRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      lastSavedDataRef.current = data;
      doSave(fileIdRef.current, data, false);
    }, 1500);
  }, [doSave]);

  useEffect(() => {
    function handleLoad(e) {
      loadScene(e.detail.fileId, e.detail.sceneData);
    }

    function handleSaveNow() {
      if (excRef.current && fileIdRef.current) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        const elements = excRef.current.getSceneElements();
        const appState = excRef.current.getAppState();
        const filteredAppState = {
          ...(appState.viewBackgroundColor != null ? { viewBackgroundColor: appState.viewBackgroundColor } : {}),
          ...(appState.gridSize != null ? { gridSize: appState.gridSize } : {}),
        };
        const files = excRef.current.getFiles();
        const data = JSON.stringify({ elements, appState: filteredAppState, files });
        lastSavedDataRef.current = data;
        doSave(fileIdRef.current, data, true);
      }
    }

    window.addEventListener('excalidraw:load', handleLoad);
    window.addEventListener('excalidraw:save-now', handleSaveNow);
    window.dispatchEvent(new CustomEvent('excalidraw:ready'));

    return () => {
      window.removeEventListener('excalidraw:load', handleLoad);
      window.removeEventListener('excalidraw:save-now', handleSaveNow);
    };
  }, [doSave, loadScene]);

  const initApi = useCallback(function(api) {
    excRef.current = api;
    if (queuedLoadRef.current) {
      var q = queuedLoadRef.current;
      queuedLoadRef.current = null;
      setTimeout(function() {
        loadScene(q.fileId, q.sceneData);
      }, 0);
    }
  }, [loadScene]);

  if (!ExcalidrawComp) {
    return (
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.4 }}>
        加载中...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="exc-host"
      style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
    >
      <ExcalidrawComp
        excalidrawAPI={initApi}
        onChange={onChange}
        langCode="zh-CN"
        theme={theme}
      />
    </div>
  );
}
