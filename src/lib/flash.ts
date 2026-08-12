let flashTimer: number | undefined

/** Small transient toast at the bottom of the screen. */
export function flash(msg: string, ms = 1600) {
  let el = document.getElementById('autocue-flash')
  if (!el) {
    el = document.createElement('div')
    el.id = 'autocue-flash'
    el.style.cssText =
      'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#1c1c1c;border:1px solid #2a2a2a;color:#e5e5e5;padding:8px 16px;border-radius:8px;font-size:14px;z-index:9999;transition:opacity .3s'
    document.body.appendChild(el)
  }
  el.textContent = msg
  el.style.opacity = '1'
  window.clearTimeout(flashTimer)
  flashTimer = window.setTimeout(() => {
    if (el) el.style.opacity = '0'
  }, ms)
}
