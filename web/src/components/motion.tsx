"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SPLASH_EVENT } from "@/lib/splash";
import { haptic, sound } from "@/lib/sound";
import { Drip, type DripMood } from "./Drip";

/* The prototype's effects: confetti, coin rain, the paper plane, coins dropping
   into a tank, numbers counting up, the full-screen celebration, the badge
   pop-up and the splash. Everything is skipped for people who ask for less motion. */

const COIN = "/usdc.webp";
const CONFETTI = ["#21BCEE", "#1B4FD8", "#F4E8D2", "#FFFFFF", "#052698", "#12B76A"];
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The fixed layer that confetti and coins fly in, above everything. */
function layer(): HTMLElement {
  let el = document.getElementById("fx");
  if (!el) {
    el = document.createElement("div");
    el.id = "fx";
    el.className = "fx";
    el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el);
  }
  return el;
}

function coin(className: string) {
  const img = document.createElement("img");
  img.src = COIN;
  img.alt = "";
  img.className = className;
  return img;
}

/** Confetti, with the odd coin, bursting up from a point on screen. */
export function confetti(x: number, y: number, n = 40) {
  if (reducedMotion()) return;
  const fx = layer();
  for (let i = 0; i < n; i++) {
    let el: HTMLElement;
    if (i % 4 === 0) el = coin("fx-coin");
    else {
      el = document.createElement("span");
      el.className = "fx-cf";
      el.style.background = CONFETTI[i % CONFETTI.length];
      if (i % 3 === 0) {
        el.style.borderRadius = "50%";
        el.style.width = el.style.height = "9px";
      }
    }
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    fx.appendChild(el);
    const a = rand(-Math.PI * 0.92, -Math.PI * 0.08);
    const v = rand(160, 420);
    const dx = Math.cos(a) * v;
    const dy = Math.sin(a) * v;
    const r = rand(-600, 600);
    el.animate(
      [
        { transform: "translate(-50%,-50%) rotate(0)", opacity: 1 },
        { transform: `translate(calc(-50% + ${dx * 0.85}px),calc(-50% + ${dy * 0.85}px)) rotate(${r / 2}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(calc(-50% + ${dx}px),calc(-50% + ${dy + 420}px)) rotate(${r}deg)`, opacity: 0 },
      ],
      { duration: rand(1300, 2000), easing: "cubic-bezier(.2,.6,.35,1)" },
    ).onfinish = () => el.remove();
  }
}

/** Confetti from a point inside an element (fractions of its width and height). */
export function confettiFrom(el: Element | null | undefined, n = 40, fx = 0.5, fy = 0.5) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  confetti(r.left + r.width * fx, r.top + r.height * fy, n);
}

/** USDC coins raining down the whole screen. */
export function coinRain(n = 34) {
  if (reducedMotion()) return;
  const fx = layer();
  const h = window.innerHeight;
  for (let i = 0; i < n; i++) {
    const img = coin("fx-coin");
    img.style.width = `${rand(24, 50)}px`;
    img.style.left = `${rand(-4, 96)}%`;
    img.style.top = "-70px";
    fx.appendChild(img);
    img.animate([{ transform: "translate(0,0) rotate(0)" }, { transform: `translate(${rand(-60, 60)}px,${h + 140}px) rotate(${rand(-500, 500)}deg)` }], {
      duration: rand(1500, 2600),
      delay: i * 34 + rand(0, 200),
      easing: "cubic-bezier(.45,0,.75,.6)",
      fill: "backwards",
    }).onfinish = () => img.remove();
  }
}

/** A paper plane flies off from a button: something was sent. */
export function flyPlane(from: Element | null | undefined) {
  sound.send();
  if (!from || reducedMotion()) return;
  const r = from.getBoundingClientRect();
  const plane = document.createElement("span");
  plane.className = "fx-plane";
  plane.textContent = "📨";
  plane.style.left = `${r.left + r.width / 2}px`;
  plane.style.top = `${r.top + r.height / 2}px`;
  layer().appendChild(plane);
  plane.animate(
    [
      { transform: "translate(-50%,-50%) scale(.6) rotate(0)" },
      { transform: "translate(40px,-160px) scale(1.3) rotate(-15deg)", offset: 0.5 },
      { transform: "translate(200px,-560px) scale(.6) rotate(-25deg)", opacity: 0 },
    ],
    { duration: 900, easing: "cubic-bezier(.4,0,.6,1)" },
  ).onfinish = () => plane.remove();
}

/** A coin drops into a water tank, rings the surface and shows who paid. */
export function dropCoin(tank: HTMLElement | null | undefined, label?: string) {
  if (!tank || reducedMotion()) return;
  const water = tank.querySelector<HTMLElement>(".wt-water");
  if (!water) return;
  sound.coin();
  const h = tank.offsetHeight;
  const level = water.offsetHeight;
  const x = rand(18, 82);
  const img = coin("wt-drop");
  img.style.left = `${x}%`;
  tank.appendChild(img);
  const end = Math.max(30, h - level - 12);
  img.animate([{ transform: "translate(-50%,0) rotate(0)" }, { transform: `translate(-50%,${end + 30}px) rotate(260deg)` }], {
    duration: 620,
    easing: "cubic-bezier(.5,0,.75,0)",
  }).onfinish = () => {
    img.remove();
    sound.plop();
    const ring = document.createElement("span");
    ring.className = "wt-rip";
    ring.style.left = `${x}%`;
    ring.style.top = `${h - level}px`;
    tank.appendChild(ring);
    setTimeout(() => ring.remove(), 750);
    if (!label) return;
    const tag = document.createElement("span");
    tag.className = "wt-plus";
    tag.textContent = label;
    tag.style.left = `${Math.min(75, Math.max(25, x))}%`;
    // It floats up about 44px, so start low enough to stay inside the tank.
    tag.style.top = `${Math.max(56, h - level - 40)}px`;
    tank.appendChild(tag);
    tag.animate(
      [
        { opacity: 0, transform: "translate(-50%,10px) scale(.7)" },
        { opacity: 1, transform: "translate(-50%,-6px) scale(1.05)", offset: 0.2 },
        { opacity: 1, transform: "translate(-50%,-30px)", offset: 0.75 },
        { opacity: 0, transform: "translate(-50%,-44px)" },
      ],
      { duration: 1700, easing: "cubic-bezier(.2,.8,.2,1)" },
    ).onfinish = () => tag.remove();
  };
}

/** Replays an animation class on an element. */
export function replay(el: Element | null | undefined, className: string) {
  if (!el) return;
  el.classList.remove(className);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(className);
}

/** Something isn't allowed: it shakes, with a buzz. */
export function shake(el: Element | null | undefined) {
  replay(el, "shake");
  sound.nope();
  haptic([30, 30, 30]);
}

/** A number that counts up (easing out) to `target`, and on to any new target. */
export function useCountUp(target: number, { duration = 1200, delay = 0, from = 0 }: { duration?: number; delay?: number; from?: number } = {}) {
  const [value, setValue] = useState(from);
  const shown = useRef(from);
  useEffect(() => {
    const start = shown.current;
    const begin = performance.now() + delay;
    let frame = 0;
    const tick = (now: number) => {
      if (now < begin) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const p = reducedMotion() ? 1 : Math.min(1, (now - begin) / duration);
      const v = start + (target - start) * (1 - Math.pow(1 - p, 3));
      shown.current = v;
      setValue(v);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, delay]);
  return value;
}

/** Shown text for a number that counts up. */
export function CountUp({ value, format, duration, delay, from }: { value: number; format: (n: number) => ReactNode; duration?: number; delay?: number; from?: number }) {
  const v = useCountUp(value, { duration, delay, from });
  return <>{format(v)}</>;
}

const SEA_FRONT = "M0 40 C240 10 480 10 720 40 S1200 70 1440 40 S1920 10 2160 40 S2640 70 2880 40 V90 H0Z";
const SEA_BACK = "M0 56 C240 30 480 80 720 56 S1200 30 1440 56 S1920 80 2160 56 S2640 30 2880 56 V90 H0Z";

/** Two layers of waves drifting past each other along the bottom of a blue surface. */
export function Sea({ height = 110, wave = 80, lift = 22, slow = 12, fast = 8, frontOpacity, style }: { height?: number; wave?: number; lift?: number; slow?: number; fast?: number; frontOpacity?: number; style?: CSSProperties }) {
  const vars = {
    "--sea-h": `${height}px`,
    "--sea-wave": `${wave}px`,
    "--sea-lift": `${lift}px`,
    "--sea-t1": `${slow}s`,
    "--sea-t2": `${fast}s`,
    ...(frontOpacity !== undefined ? { "--sea-o1": frontOpacity } : {}),
    ...style,
  } as CSSProperties;
  return (
    <div className="sea" style={vars} aria-hidden="true">
      <svg className="w1" viewBox="0 0 2880 90" preserveAspectRatio="none">
        <path d={SEA_FRONT} />
      </svg>
      <svg className="w2" viewBox="0 0 2880 90" preserveAspectRatio="none">
        <path d={SEA_BACK} />
      </svg>
    </div>
  );
}

/** Rings spreading out while something is confirmed; with `done`, a green tick draws itself. */
export function Ripples({ size = 140, done = false }: { size?: number; done?: boolean }) {
  return (
    <div className="ripw" style={{ "--ripw": `${size}px` } as CSSProperties} aria-hidden="true">
      <span className="ring" />
      <span className="ring" />
      <span className="ring" />
      {done && (
        <span className="okdot">
          <svg viewBox="0 0 24 24">
            <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </div>
  );
}

function Portal({ children }: { children: ReactNode }) {
  return typeof document === "undefined" ? null : createPortal(children, document.body);
}

export interface CelebrationButton {
  label: string;
  onClick?: () => void;
  ghost?: boolean;
}

/**
 * The full-screen moment: rays, Drip jumping, the headline rising line by line,
 * an amount counting up, confetti and a rain of coins.
 */
export function Celebration({ l1, l2, k, value, format, text, pills, mood = "cheer", rain = true, buttons, children }: { l1: string; l2?: string; k?: string; value?: number; format?: (n: number) => ReactNode; text?: ReactNode; pills?: string[]; mood?: DripMood; rain?: boolean; buttons: CelebrationButton[]; children?: ReactNode }) {
  const [out, setOut] = useState(false);
  const shown = useCountUp(value ?? 0, { duration: 1300, delay: 500 });
  // Once, even when React runs the effect twice in development.
  const cheered = useRef(false);
  useEffect(() => {
    if (cheered.current) return;
    cheered.current = true;
    sound.big();
    haptic([20, 40, 20]);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      confetti(window.innerWidth / 2, window.innerHeight * 0.3, 60);
      if (rain) coinRain(40);
    }, 250);
    return () => clearTimeout(t);
  }, [rain]);
  return (
    <Portal>
      <div className={`cele${out ? " out" : ""}`} role="dialog" aria-modal="true" aria-label={[l1, l2].filter(Boolean).join(" ")}>
        <div className="grain" />
        <div className="cele-rays" />
        <div className="cele-body">
          <Drip size={130} mood={mood} onBlue move="jump" pop />
          <h2 className="say say-anim">
            <span>{l1}</span>
            {l2 && <span className="l2">{l2}</span>}
          </h2>
          {k && <p className="cele-k">{k}</p>}
          {value !== undefined && <p className="cele-v">{format ? format(shown) : Math.round(shown)}</p>}
          {text && <p className="cele-s">{text}</p>}
          {children}
          {pills && (
            <div className="cele-pills">
              {pills.map((p, i) => (
                <span key={p} className="cele-pill" style={{ animationDelay: `${0.7 + i * 0.12}s` }}>
                  {p}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="cele-foot">
          {buttons.map((b) => (
            <button
              key={b.label}
              className={b.ghost ? "btn btn-ghost" : "btn btn-white"}
              onClick={() => {
                setOut(true);
                setTimeout(() => b.onClick?.(), 200);
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
        <Sea height={120} wave={90} lift={24} frontOpacity={0.9} />
      </div>
    </Portal>
  );
}

/** "Badge unlocked": a medal spins in, shines, and throws confetti. */
export function Achievement({ icon, k = "Badge unlocked", title, text, button = "Nice!", onClose }: { icon: string; k?: string; title: string; text: string; button?: string; onClose: () => void }) {
  const medal = useRef<HTMLDivElement>(null);
  const cheered = useRef(false);
  useEffect(() => {
    if (cheered.current) return;
    cheered.current = true;
    sound.win();
    haptic(30);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => confettiFrom(medal.current, 30), 400);
    return () => clearTimeout(t);
  }, []);
  return (
    <Portal>
      <div className="ach-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="ach" role="dialog" aria-modal="true" aria-label={title}>
          <div className="ach-medal" ref={medal}>
            {icon}
          </div>
          <p className="ach-k">{k}</p>
          <h3>{title}</h3>
          <p>{text}</p>
          <button className="btn btn-primary" onClick={onClose}>
            {button}
          </button>
        </div>
      </div>
    </Portal>
  );
}

/** Shows the splash again, e.g. after signing out. */
export function playSplash() {
  if (reducedMotion()) return;
  document.documentElement.dataset.splash = "on";
  window.dispatchEvent(new Event(SPLASH_EVENT));
}

/**
 * The pool fills and the logo splashes in while the app opens or reloads.
 * A script in the page head turns it on before anything is drawn, and a tap skips it.
 */
export function Splash() {
  const el = useRef<HTMLDivElement>(null);
  const [round, setRound] = useState(0);
  useEffect(() => {
    const onPlay = () => setRound((n) => n + 1);
    window.addEventListener(SPLASH_EVENT, onPlay);
    return () => window.removeEventListener(SPLASH_EVENT, onPlay);
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.splash !== "on") return;
    let gone = false;
    const finish = () => {
      if (gone) return;
      gone = true;
      el.current?.classList.add("out");
      setTimeout(() => {
        root.dataset.splash = "off";
        el.current?.classList.remove("out");
      }, 260);
    };
    const t = setTimeout(finish, 2300);
    const node = el.current;
    node?.addEventListener("click", finish);
    return () => {
      clearTimeout(t);
      node?.removeEventListener("click", finish);
    };
  }, [round]);
  return (
    <div key={round} ref={el} className="splash" aria-hidden="true">
      <div className="grain" />
      <div className="splash-water" />
      <div className="splash-logo">
        <svg aria-hidden="true">
          <use href="/icons.svg#logo" />
        </svg>
        <span>PoolFi</span>
      </div>
    </div>
  );
}
