import { useEffect, useRef, useCallback, useState } from 'react';
import '@excalidraw/excalidraw/index.css';

function LibraryHandler({ excalidrawAPI }) {
  useEffect(() => {
    if (!excalidrawAPI) return;

    const processLibraryHash = async () => {
      const hash = window.location.hash;
      if (!hash.includes('addLibrary')) return;

      const params = new URLSearchParams(hash.slice(1));
      const libraryUrl = params.get('addLibrary');
      if (!libraryUrl) return;

      try {
        // Clear the hash immediately
        window.history.replaceState({}, '', window.location.pathname + window.location.search);

        const decoded = decodeURIComponent(libraryUrl);

        // Validate URL
        try {
          const u = new URL(decoded);
          if (u.hostname !== 'libraries.excalidraw.com' && !u.hostname.endsWith('.excalidraw.com')) {
            console.warn('[LibraryHandler] Invalid library URL hostname:', u.hostname);
            return;
          }
        } catch { return; }

        // Fetch the library
        const resp = await fetch(decoded);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();

        // Import into Excalidraw
        await excalidrawAPI.updateLibrary({
          libraryItems: blob,
          prompt: false,
          merge: true,
          defaultStatus: 'published',
          openLibraryMenu: true,
        });

        // Trigger save to persist library items
        window.dispatchEvent(new CustomEvent('excalidraw:save-now'));
      } catch (err) {
        console.error('[LibraryHandler] Failed to import library:', err);
        excalidrawAPI.updateScene({ appState: { errorMessage: String(err) } });
      }
    };

    // Process on mount (in case hash was set before component mounted)
    processLibraryHash();

    // Listen for hashchange events (when redirect happens while page is loaded)
    window.addEventListener('hashchange', processLibraryHash);
    return () => window.removeEventListener('hashchange', processLibraryHash);
  }, [excalidrawAPI]);

  return null;
}

export default function ExcalidrawWrapper() {
  const containerRef = useRef(null);
  const fileIdRef = useRef(null);
  const timerRef = useRef(null);
  const autoSaveRef = useRef(false);
  const queuedLoadRef = useRef(null);
  const skipDirtyRef = useRef(false);
  const lastSavedDataRef = useRef(null);
  const viewportMapRef = useRef({});
  const pendingLibraryRef = useRef(null);
  const libraryItemsRef = useRef([]);
  const libraryInitedRef = useRef(false);
  const [ExcalidrawComp, setExcalidrawComp] = useState(null);
  const [theme, setTheme] = useState('light');
  const [apiReady, setApiReady] = useState(false);
  const excRef = useRef(null);
  const excalidrawAPIRef = useRef(null);

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
      // Load pending library items from localStorage (saved when no file was loaded)
      const pendingLib = localStorage.getItem('yooexcalidraw_pending_library');
      if (pendingLib) {
        try {
          const items = JSON.parse(pendingLib);
          if (Array.isArray(items) && items.length > 0) {
            pendingLibraryRef.current = items;
            console.log('[ExcalidrawWrapper] Loaded pending library from localStorage:', items.length, 'items');
          }
          localStorage.removeItem('yooexcalidraw_pending_library');
        } catch (e) { /* ignore */ }
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
      // restore per-file viewport
      var vp = viewportMapRef.current[fileId];
      if (vp) {
        excRef.current.updateScene({
          appState: {
            scrollX: vp.scrollX,
            scrollY: vp.scrollY,
            zoom: vp.zoom,
          },
        });
      }
      // restore library items from file
      if (sceneData.libraryItems && Array.isArray(sceneData.libraryItems) && sceneData.libraryItems.length > 0) {
        libraryItemsRef.current = sceneData.libraryItems;
        // Use global function to set library in Excalidraw
        if (typeof window !== 'undefined' && window.__setExcalidrawLibraryItems) {
          try {
            window.__setExcalidrawLibraryItems(sceneData.libraryItems);
          } catch (e) {
            console.warn('[ExcalidrawWrapper] setLibraryItems failed:', e);
          }
        }
      }
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
      libraryItems: sceneData.libraryItems || [],
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
    // save viewport per file
    viewportMapRef.current[fileIdRef.current] = {
      scrollX: appState.scrollX,
      scrollY: appState.scrollY,
      zoom: appState.zoom,
    };
    const filteredAppState = {
      ...(appState.viewBackgroundColor != null ? { viewBackgroundColor: appState.viewBackgroundColor } : {}),
      ...(appState.gridSize != null ? { gridSize: appState.gridSize } : {}),
    };
    // Include libraryItems in save data so they persist across sessions
    // Read directly from Excalidraw's internal library via React fiber
    const currentLib = (typeof window !== 'undefined' && window.__getExcalidrawLibraryItems) || (() => []);
    const data = JSON.stringify({ elements, appState: filteredAppState, files, libraryItems: currentLib() });
    if (data === lastSavedDataRef.current) return;
    window.dispatchEvent(new CustomEvent('excalidraw:dirty'));
    if (!autoSaveRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      lastSavedDataRef.current = data;
      doSave(fileIdRef.current, data, false);
    }, 1500);
  }, [doSave]);

  const onLibraryChange = useCallback((libraryItems) => {
    // Track current library items for saving
    libraryItemsRef.current = libraryItems || [];
    console.log('[ExcalidrawWrapper] onLibraryChange:', libraryItems?.length, 'items, excRef:', !!excRef.current);
    // Excalidraw fires onLibraryChange on mount with current IndexedDB state;
    // skip the initial fire so we don't overwrite file-saved library with stale data
    if (!libraryInitedRef.current) {
      libraryInitedRef.current = true;
      console.log('[ExcalidrawWrapper] onLibraryChange: initial fire, skipping');
      // If we have pending library items from localStorage, apply them now
      if (pendingLibraryRef.current && pendingLibraryRef.current.length > 0) {
        console.log('[ExcalidrawWrapper] Pending library items found:', pendingLibraryRef.current.length);
        if (excRef.current?.updateLibrary) {
          try {
            console.log('[ExcalidrawWrapper] Applying pending library items via updateLibrary');
            excRef.current.updateLibrary({ libraryItems: pendingLibraryRef.current });
          } catch (e) { console.warn('[ExcalidrawWrapper] updateLibrary failed:', e); }
          pendingLibraryRef.current = null;
        } else {
          console.log('[ExcalidrawWrapper] excRef not ready, will retry on next render');
        }
      }
      return;
    }
    console.log('[ExcalidrawWrapper] onLibraryChange: dispatching event');
    window.dispatchEvent(new CustomEvent('excalidraw:library-change', {
      detail: { libraryItems },
    }));
  }, []);

  useEffect(() => {
    function handleLoad(e) {
      loadScene(e.detail.fileId, e.detail.sceneData);
    }

    function handleSaveNow() {
      if (excRef.current) {
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
        const currentLib = (typeof window !== 'undefined' && window.__getExcalidrawLibraryItems) || (() => []);
        const libraryItems = currentLib();
        const data = JSON.stringify({ elements, appState: filteredAppState, files, libraryItems });
        lastSavedDataRef.current = data;
        if (fileIdRef.current) {
          doSave(fileIdRef.current, data, true);
        } else if (libraryItems.length > 0) {
          // No file loaded - save library to localStorage so it persists
          try {
            localStorage.setItem('yooexcalidraw_pending_library', JSON.stringify(libraryItems));
          } catch (e) { /* ignore */ }
        }
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
    excalidrawAPIRef.current = api;
    setApiReady(true);
    // Expose to window for library persistence
    if (typeof window !== 'undefined') {
      (window as any).__excalidrawRef = api;
    }
    // Intercept updateLibrary to capture library items
    if (api && api.updateLibrary) {
      const origUpdateLibrary = api.updateLibrary.bind(api);
      api.updateLibrary = function(opts) {
        if (opts && opts.libraryItems) {
          libraryItemsRef.current = opts.libraryItems;
        }
        return origUpdateLibrary(opts);
      };
    }
    // Apply pending library items from localStorage if onLibraryChange didn't (API wasn't ready)
    if (pendingLibraryRef.current && pendingLibraryRef.current.length > 0 && api?.updateLibrary) {
      try {
        console.log('[ExcalidrawWrapper] initApi: Applying pending library items');
        api.updateLibrary({ libraryItems: pendingLibraryRef.current });
        pendingLibraryRef.current = null;
      } catch (e) { console.warn('[ExcalidrawWrapper] initApi updateLibrary failed:', e); }
    }
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
      <LibraryHandler excalidrawAPI={apiReady ? excalidrawAPIRef.current : null} />
      <ExcalidrawComp
        excalidrawAPI={initApi}
        onChange={onChange}
        onLibraryChange={onLibraryChange}
        langCode="zh-CN"
        theme={theme}
      />
    </div>
  );
}
