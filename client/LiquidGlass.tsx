import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { useTheme } from './theme';

interface Ripple { x: number; y: number; born: number; strength: number }
type ElementRef = RefObject<HTMLDivElement | null>;

/** Pointer effects stay outside React state, so typing never redraws the form. */
export function LiquidScene({ root, card }: { root: ElementRef; card: ElementRef }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { resolved } = useTheme();
  const dark = useRef(resolved === 'dark');
  dark.current = resolved === 'dark';

  useEffect(() => {
    const element = root.current;
    const surface = canvas.current;
    if (!element || !surface) return;
    const context = surface.getContext('2d');
    if (!context) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const fine = window.matchMedia('(pointer: fine)');
    let width = 1, height = 1, frame = 0, lastPaint = 0;
    let pointerX = 0.5, pointerY = 0.45, currentX = 0.5, currentY = 0.45;
    let presence = 0, targetPresence = 0, lastRipple = 0, lastX = -1000, lastY = -1000;
    let ripples: Ripple[] = [];
    let lastDark = dark.current;

    const addRipple = (x: number, y: number, strength: number) => {
      ripples = [...ripples.slice(-11), { x, y, strength, born: performance.now() }];
      lastRipple = performance.now(); lastX = x; lastY = y;
    };
    const paint = (now: number) => {
      const night = dark.current;
      const time = reduced.matches ? 0 : now / 1000;
      context.clearRect(0, 0, width, height);
      // A few flowing contours give the lens something to refract, without a busy wallpaper.
      for (let lane = 0; lane < 12; lane++) {
        context.beginPath();
        for (let step = 0; step <= 75; step++) {
          const u = step / 75;
          const x = u * (width + 160) - 80;
          const y = height * .56 + (lane - 5.5) * 13 +
            Math.sin(u * 4.2 + time * .11 + lane * .035) * height * .13 +
            Math.cos(u * 7.5 - time * .08) * 18 + (currentY - .5) * 24;
          if (step === 0) context.moveTo(x, y); else context.lineTo(x, y);
        }
        context.strokeStyle = night ? `rgba(162,208,231,${lane % 3 === 0 ? .115 : .055})` : `rgba(75,117,145,${lane % 3 === 0 ? .115 : .05})`;
        context.lineWidth = lane % 3 === 0 ? 1 : .6;
        context.stroke();
      }
      if (presence > .01) {
        const glow = context.createRadialGradient(currentX * width, currentY * height, 0, currentX * width, currentY * height, 260);
        glow.addColorStop(0, night ? `rgba(123,191,221,${presence * .13})` : `rgba(255,255,255,${presence * .55})`);
        glow.addColorStop(1, 'rgba(255,255,255,0)');
        context.fillStyle = glow; context.fillRect(0, 0, width, height);
      }
      ripples = ripples.filter(ripple => now - ripple.born < 2400);
      for (const ripple of ripples) {
        const progress = (now - ripple.born) / 2400;
        const alpha = Math.pow(1 - progress, 2) * Math.min(1, progress * 15) * ripple.strength;
        const radius = 12 + (1 - Math.pow(1 - progress, 2)) * (ripple.strength > 1 ? 270 : 175);
        for (let ring = 0; ring < 2; ring++) {
          const r = radius * (ring ? .76 : 1);
          const opacity = alpha * (ring ? .42 : 1);
          const glint = context.createLinearGradient(ripple.x - r, ripple.y - r, ripple.x + r, ripple.y + r);
          glint.addColorStop(0, `rgba(255,255,255,${opacity * (night ? .64 : .95)})`);
          glint.addColorStop(.45, `rgba(173,211,234,${opacity * .2})`);
          glint.addColorStop(1, `rgba(255,255,255,${opacity * .65})`);
          context.beginPath(); context.ellipse(ripple.x, ripple.y, r, r * .7, -.12, 0, Math.PI * 2);
          context.strokeStyle = glint; context.lineWidth = 1.7;
          context.shadowColor = `rgba(193,233,255,${opacity * .35})`; context.shadowBlur = 7; context.stroke();
          context.shadowBlur = 0;
          context.beginPath(); context.ellipse(ripple.x, ripple.y + 2, Math.max(1, r - 2), Math.max(1, r * .7 - 2), -.12, 0, Math.PI * 2);
          context.strokeStyle = `rgba(${night ? '7,25,42' : '54,104,140'},${opacity * .2})`; context.lineWidth = 1; context.stroke();
        }
      }
    };
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - lastPaint < 1000 / 30) return;
      lastPaint = now;
      currentX += (pointerX - currentX) * .12;
      currentY += (pointerY - currentY) * .12;
      presence += (targetPresence - presence) * .1;
      element.style.setProperty('--scene-x', `${((currentX - .5) * 36).toFixed(2)}px`);
      element.style.setProperty('--scene-y', `${((currentY - .5) * 28).toFixed(2)}px`);
      paint(now);
    };
    const syncMotion = () => {
      cancelAnimationFrame(frame); frame = 0;
      if (reduced.matches || document.hidden) {
        ripples = []; targetPresence = presence = 0;
        currentX = pointerX = .5; currentY = pointerY = .45;
        element.style.removeProperty('--scene-x'); element.style.removeProperty('--scene-y');
        element.style.removeProperty('--glass-light-x'); element.style.removeProperty('--glass-light-y');
        element.style.removeProperty('--glass-angle');
        paint(0);
      } else { lastPaint = 0; frame = requestAnimationFrame(tick); }
    };
    const resize = () => {
      const rect = element.getBoundingClientRect();
      width = Math.max(1, rect.width); height = Math.max(1, rect.height);
      const scale = Math.min(window.devicePixelRatio || 1, 1.5, 1800 / width, 1200 / height);
      surface.width = Math.round(width * scale); surface.height = Math.round(height * scale);
      context.setTransform(scale, 0, 0, scale, 0, 0); paint(performance.now());
    };
    const move = (event: PointerEvent) => {
      if (reduced.matches || !fine.matches || event.pointerType !== 'mouse') return;
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      pointerX = Math.max(0, Math.min(1, x / width)); pointerY = Math.max(0, Math.min(1, y / height));
      targetPresence = 1;
      const glass = card.current?.getBoundingClientRect();
      if (glass) {
        const gx = Math.max(0, Math.min(100, (event.clientX - glass.left) / glass.width * 100));
        const gy = Math.max(0, Math.min(100, (event.clientY - glass.top) / glass.height * 100));
        element.style.setProperty('--glass-light-x', `${gx.toFixed(1)}%`);
        element.style.setProperty('--glass-light-y', `${gy.toFixed(1)}%`);
        element.style.setProperty('--glass-angle', `${(Math.atan2(event.clientY - glass.top - glass.height / 2, event.clientX - glass.left - glass.width / 2) * 180 / Math.PI + 90).toFixed(1)}deg`);
      }
      if (!(event.target as Element).closest('.login-form-container') && performance.now() - lastRipple > 110 && Math.hypot(x - lastX, y - lastY) > 32) addRipple(x, y, .82);
    };
    const press = (event: PointerEvent) => {
      if (reduced.matches || (event.target as Element).closest('button, a, input, select, textarea, label, .login-form-container')) return;
      const rect = element.getBoundingClientRect();
      addRipple(event.clientX - rect.left, event.clientY - rect.top, 1.35);
    };
    const leave = () => {
      pointerX = .5; pointerY = .45; targetPresence = 0;
      element.style.removeProperty('--glass-light-x'); element.style.removeProperty('--glass-light-y'); element.style.removeProperty('--glass-angle');
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    // Repaint the static surface as well when the chosen color scheme changes.
    const themeObserver = new MutationObserver(() => {
      if (lastDark !== dark.current) { lastDark = dark.current; paint(performance.now()); }
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    element.addEventListener('pointermove', move, { passive: true });
    element.addEventListener('pointerdown', press, { passive: true });
    element.addEventListener('pointerleave', leave);
    fine.addEventListener('change', leave);
    reduced.addEventListener('change', syncMotion);
    document.addEventListener('visibilitychange', syncMotion);
    resize(); syncMotion();
    return () => {
      cancelAnimationFrame(frame); observer.disconnect(); themeObserver.disconnect();
      element.removeEventListener('pointermove', move); element.removeEventListener('pointerdown', press); element.removeEventListener('pointerleave', leave);
      fine.removeEventListener('change', leave);
      reduced.removeEventListener('change', syncMotion); document.removeEventListener('visibilitychange', syncMotion);
      for (const name of ['--scene-x', '--scene-y', '--glass-light-x', '--glass-light-y', '--glass-angle']) element.style.removeProperty(name);
    };
  }, [root, card]);

  return <div className="login-liquid-scene" aria-hidden="true">
    <div className="liquid-silk liquid-silk-one" /><div className="liquid-silk liquid-silk-two" />
    <canvas ref={canvas} className="liquid-water" />
  </div>;
}

function edgeMap(width: number, height: number, radius: number): string {
  const scale = Math.min(1, 480 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) return '';
  const image = context.createImageData(canvas.width, canvas.height);
  const halfWidth = canvas.width / 2, halfHeight = canvas.height / 2;
  const r = Math.min(radius * scale, halfWidth, halfHeight), band = 22 * scale;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const dx = x - halfWidth, dy = y - halfHeight;
      const qx = Math.abs(dx) - (halfWidth - r), qy = Math.abs(dy) - (halfHeight - r);
      const outsideX = Math.max(qx, 0), outsideY = Math.max(qy, 0);
      const distance = Math.hypot(outsideX, outsideY);
      const depth = r - distance - Math.min(Math.max(qx, qy), 0);
      let nx = 0, ny = 0, bend = 0;
      if (depth >= 0 && depth < band) {
        bend = Math.pow(1 - depth / band, 1.7);
        if (distance > 0) { nx = Math.sign(dx) * outsideX / distance; ny = Math.sign(dy) * outsideY / distance; }
        else if (qx > qy) nx = Math.sign(dx); else ny = Math.sign(dy);
      }
      const offset = (y * canvas.width + x) * 4;
      image.data[offset] = Math.round(128 + nx * bend * 112);
      image.data[offset + 1] = Math.round(128 + ny * bend * 112);
      image.data[offset + 2] = 128; image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

/** Displacement is confined to the glass rim; labels and form controls stay sharp. */
export function GlassSurface({ card }: { card: ElementRef }) {
  const id = `glass-${useId().replace(/[^\w-]/g, '')}`;
  const [map, setMap] = useState<{ url: string; width: number; height: number } | null>(null);
  useEffect(() => {
    const element = card.current;
    if (!element) return;
    let previous = '', frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = element.clientWidth, height = element.clientHeight;
        const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 32;
        const size = `${width}:${height}:${radius}`;
        if (size === previous || width < 1 || height < 1) return;
        previous = size; setMap({ url: edgeMap(width, height, radius), width, height });
      });
    };
    const observer = new ResizeObserver(update); observer.observe(element); update();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [card]);
  return <>
    <svg className="liquid-filter-definitions" aria-hidden="true" width="0" height="0"><defs>
      <filter id={id} filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="0" y="0" width={map?.width || 1} height={map?.height || 1} colorInterpolationFilters="sRGB">
        <feImage href={map?.url || undefined} x="0" y="0" width={map?.width || 1} height={map?.height || 1} preserveAspectRatio="none" result="edge-map" />
        <feDisplacementMap in="SourceGraphic" in2="edge-map" scale="32" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </defs></svg>
    <div className="liquid-glass-base" aria-hidden="true" />
    {map?.url && <div className="liquid-glass-refraction" aria-hidden="true" style={{ backdropFilter: `url("#${id}")`, WebkitBackdropFilter: `url("#${id}")` }} />}
    <div className="liquid-glass-sheen" aria-hidden="true" /><div className="liquid-glass-rim" aria-hidden="true" />
  </>;
}
