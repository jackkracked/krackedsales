/**
 * demo-director.js — an on-brand "demo director" injected into the live app (via the
 * browser javascript_tool) while a GIF is recorded. It draws a deliberate, premium
 * cursor and an optional caption chip, then drives clicks, so every feature clip looks
 * designed rather than like a raw screen grab.
 *
 * Not part of the app bundle. Paste / inject this whole file, then drive the demo with
 * the window.__demo API:
 *
 *   await __demo.init()
 *   __demo.caption("Click any number to verify it")
 *   await __demo.moveTo('[data-demo="rep-open-cell"]')
 *   await __demo.click()
 *   await __demo.wait(1400)
 *   __demo.cleanup()
 *
 * Or one-shot:  await __demo.run([
 *   { caption: "Click any number to verify it" },
 *   { moveTo: '[data-demo="rep-open-cell"]' },
 *   { click: true }, { wait: 1500 },
 * ])
 *
 * Brand tokens: primary petrol-navy #0F3A5C, ink #1C2333, paper #FAFAF7, gold #D4A574.
 */
(function () {
  const PRIMARY = "#0F3A5C";
  const INK = "#1C2333";
  const PAPER = "#FAFAF7";
  const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"; // ease-out-quint
  const reduce =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  let cursor, dot, caption, layer, x = window.innerWidth / 2, y = window.innerHeight / 2;

  const sleep = (ms) => new Promise((r) => setTimeout(r, reduce ? Math.min(ms, 120) : ms));

  function init() {
    cleanup();
    layer = document.createElement("div");
    layer.id = "__demo_layer";
    layer.style.cssText =
      "position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:" +
      "ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;";

    // cursor ring
    cursor = document.createElement("div");
    cursor.style.cssText =
      "position:absolute;top:0;left:0;width:26px;height:26px;border-radius:50%;" +
      `border:2px solid ${PRIMARY};background:${PRIMARY}1A;` +
      "box-shadow:0 6px 18px rgba(15,58,92,0.28),0 1px 2px rgba(15,58,92,0.35);" +
      "transform:translate(-50%,-50%) scale(1);will-change:transform,left,top;";
    // inner dot
    dot = document.createElement("div");
    dot.style.cssText =
      "position:absolute;top:50%;left:50%;width:6px;height:6px;border-radius:50%;" +
      `background:${PRIMARY};transform:translate(-50%,-50%);`;
    cursor.appendChild(dot);

    // caption chip
    caption = document.createElement("div");
    caption.style.cssText =
      "position:absolute;left:50%;bottom:48px;transform:translate(-50%,12px);" +
      `background:${PAPER};color:${INK};font-size:13px;font-weight:600;` +
      "letter-spacing:-0.01em;padding:9px 16px;border-radius:9999px;" +
      "border:1px solid rgba(28,35,51,0.08);" +
      "box-shadow:0 8px 30px rgba(28,35,51,0.16),0 2px 6px rgba(28,35,51,0.08);" +
      "opacity:0;white-space:nowrap;max-width:80vw;overflow:hidden;text-overflow:ellipsis;";

    layer.append(cursor, caption);
    document.body.appendChild(layer);
    place(x, y, 0);
    return sleep(reduce ? 0 : 250);
  }

  function place(nx, ny, dur) {
    x = nx; y = ny;
    cursor.style.transition = dur ? `left ${dur}ms ${EASE}, top ${dur}ms ${EASE}` : "none";
    cursor.style.left = nx + "px";
    cursor.style.top = ny + "px";
  }

  function centerOf(selector) {
    const el = typeof selector === "string" ? document.querySelector(selector) : selector;
    if (!el) throw new Error("demo: selector not found -> " + selector);
    const r = el.getBoundingClientRect();
    return { el, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }

  async function moveTo(selector, opts) {
    const { cx, cy } = centerOf(selector);
    const dur = reduce ? 0 : (opts && opts.duration) || 700;
    place(cx, cy, dur);
    await sleep(dur + 60);
  }

  async function click(selector) {
    const target = selector ? centerOf(selector) : centerOf(document.elementFromPoint(x, y) || document.body);
    // click pulse
    cursor.style.transition = `transform 110ms ${EASE}`;
    cursor.style.transform = "translate(-50%,-50%) scale(0.8)";
    // ripple
    const ring = document.createElement("div");
    ring.style.cssText =
      `position:absolute;left:${x}px;top:${y}px;width:26px;height:26px;border-radius:50%;` +
      `border:2px solid ${PRIMARY};transform:translate(-50%,-50%) scale(1);opacity:0.9;`;
    layer.appendChild(ring);
    ring.animate(
      [
        { transform: "translate(-50%,-50%) scale(1)", opacity: 0.9 },
        { transform: "translate(-50%,-50%) scale(2.6)", opacity: 0 },
      ],
      { duration: reduce ? 1 : 520, easing: EASE }
    ).onfinish = () => ring.remove();
    await sleep(120);
    cursor.style.transform = "translate(-50%,-50%) scale(1)";
    // dispatch the real interaction
    const el = target.el || document.elementFromPoint(x, y);
    if (el) {
      ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((t) =>
        el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y }))
      );
    }
    await sleep(reduce ? 0 : 120);
  }

  function show(text) {
    caption.textContent = text;
    caption.style.transition = `opacity 280ms ${EASE}, transform 280ms ${EASE}`;
    caption.style.opacity = "1";
    caption.style.transform = "translate(-50%,0)";
  }
  function hideCaption() {
    caption.style.opacity = "0";
    caption.style.transform = "translate(-50%,12px)";
  }

  function cleanup() {
    const old = document.getElementById("__demo_layer");
    if (old) old.remove();
  }

  async function run(steps) {
    await init();
    for (const s of steps) {
      if (s.caption !== undefined) show(s.caption);
      if (s.moveTo) await moveTo(s.moveTo, s);
      if (s.click) await click(typeof s.click === "string" ? s.click : undefined);
      if (s.wait) await sleep(s.wait);
      if (s.hideCaption) hideCaption();
    }
  }

  // Instant placement helpers — used when a GIF is built from discrete frames
  // (each screenshot is one frame), so the cursor is placed crisply per frame
  // rather than mid-tween.
  const placeAt = (nx, ny) => place(nx, ny, 0);
  const placeOn = (selector) => {
    const { cx, cy } = centerOf(selector);
    place(cx, cy, 0);
  };

  window.__demo = { init, moveTo, click, caption: show, hideCaption, wait: sleep, cleanup, run, placeAt, placeOn };
})();
