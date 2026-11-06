// <GoogleDarkMap /> — wrapper React do motor google-dark-map.js (mapa Google com tema dark minimalista, para usar como camada de fundo).
//
//   <div style={{ position: 'fixed', inset: 0 }}>
//     <GoogleDarkMap
//       apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY}
//       center={[-23.5505, -46.6333]} zoom={14}
//       markers={[{ id: 'p1', lat: -23.55, lng: -46.63, status: 'online', title: 'Carlos' }]}
//       radiusKm={5}
//       onMarkerClick={(m) => console.log(m)}
//     >
//       {/* filhos ficam POR CIMA do mapa; use pointerEvents: 'auto' neles para receber toque */}
//     </GoogleDarkMap>
//   </div>
//
// O container pai precisa ter altura. `ref` devolve a instância do motor (flyToPoint, fitToMarkers, setRoute…).
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { GoogleDarkMap as Engine } from './google-dark-map.js';

export const GoogleDarkMap = forwardRef(function GoogleDarkMap(
  {
    apiKey, center, zoom = 14, markers, radiusKm, radiusCenter, route, userLocation,
    insetBottom = 0, zoomControl = false, locateButton = false, gestureHandling = 'greedy',
    onMarkerClick, onMapClick, onReady, onError, className, style, children,
  },
  ref,
) {
  const mountRef = useRef(null);
  const [engine, setEngine] = useState(null);
  const cb = useRef({});
  cb.current = { onMarkerClick, onMapClick, onReady, onError };   // callbacks sempre atuais sem recriar o mapa

  useImperativeHandle(ref, () => engine, [engine]);

  useEffect(() => {
    let vivo = true, inst = null;
    Engine.create(mountRef.current, {
      apiKey, center, zoom, zoomControl, locateButton, gestureHandling, insetBottom,
      onMarkerClick: (m) => cb.current.onMarkerClick?.(m),
      onMapClick: () => cb.current.onMapClick?.(),
      onReady: (e) => cb.current.onReady?.(e),
      onError: (err) => cb.current.onError?.(err),
    }).then((e) => { if (!vivo) return e.destroy(); inst = e; setEngine(e); })
      .catch((err) => cb.current.onError?.(err));
    return () => { vivo = false; inst?.destroy(); setEngine(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);   // só recria se a chave mudar; o resto é atualizado abaixo

  useEffect(() => { if (engine && markers) engine.setMarkers(markers); }, [engine, markers]);
  useEffect(() => { engine?.setInsets({ bottom: insetBottom }); }, [engine, insetBottom]);
  useEffect(() => { engine?.setRadius(radiusKm, radiusCenter ?? center); }, [engine, radiusKm, radiusCenter?.[0], radiusCenter?.[1]]);  // eslint-disable-line
  useEffect(() => { if (engine) route?.length ? engine.setRoute(route) : engine.clearRoute(); }, [engine, route]);
  useEffect(() => { if (engine && userLocation) engine.setUserLocation(userLocation[0], userLocation[1]); }, [engine, userLocation?.[0], userLocation?.[1]]);  // eslint-disable-line

  return (
    <div className={className} style={{ position: 'relative', width: '100%', height: '100%', ...style }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      {children && <div style={{ position: 'absolute', inset: 0, zIndex: 20, pointerEvents: 'none' }}>{children}</div>}
    </div>
  );
});

export default GoogleDarkMap;
