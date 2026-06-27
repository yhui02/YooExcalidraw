import { useEffect, useRef, useCallback, useState } from 'react';
import '@excalidraw/excalidraw/index.css';

export default function ExcalidrawWrapper() {
  const containerRef = useRef(null);
  const fileIdRef = useRef(null);
  const timerRef = useRef(null);
  const [ExcalidrawComp, setExcalidrawComp] = useState(null);
  const excRef = useRef(null);

  useEffect(() => {
    import('@excalidraw/excalidraw').then(mod => {
      setExcalidrawComp(() => mod.Excalidraw);
    });
  }, []);

  const doSave = useCallback((fileId, sceneData, immediate) => {
    window.dispatchEvent(new CustomEvent('excalidraw:autosave', {
      detail: { fileId, sceneData, immediate },
    }));
  }, []);

  const onChange = useCallback((elements, appState) => {
    if (!fileIdRef.current) return;
    window.dispatchEvent(new CustomEvent('excalidraw:dirty'));
    const filteredAppState = {
      ...(appState.viewBackgroundColor != null ? { viewBackgroundColor: appState.viewBackgroundColor } : {}),
      ...(appState.gridSize != null ? { gridSize: appState.gridSize } : {}),
    };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const data = JSON.stringify({ elements, appState: filteredAppState });
      doSave(fileIdRef.current, data, false);
    }, 1500);
  }, [doSave]);

  useEffect(() => {
    function handleLoad(e) {
      const { fileId, sceneData } = e.detail;
      fileIdRef.current = fileId;
      if (!excRef.current) return;
      try {
        const appStateUpdate = sceneData.appState ? {
          viewBackgroundColor: sceneData.appState.viewBackgroundColor,
        } : undefined;
        excRef.current.updateScene({
          elements: sceneData.elements || [],
          ...(appStateUpdate ? { appState: appStateUpdate } : {}),
        });
      } catch (err) {
        console.warn('[ExcalidrawWrapper] updateScene failed:', err);
      }
    }

    function handleSaveNow() {
      if (excRef.current && fileIdRef.current) {
        const elements = excRef.current.getSceneElements();
        const appState = excRef.current.getAppState();
        const filteredAppState = {
          ...(appState.viewBackgroundColor != null ? { viewBackgroundColor: appState.viewBackgroundColor } : {}),
          ...(appState.gridSize != null ? { gridSize: appState.gridSize } : {}),
        };
        const data = JSON.stringify({ elements, appState: filteredAppState });
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
  }, [doSave]);

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
        excalidrawAPI={(api) => { excRef.current = api; }}
        onChange={onChange}
        langCode="zh-CN"
        theme="light"
      />
    </div>
  );
}
