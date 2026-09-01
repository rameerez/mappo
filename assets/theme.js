// The theme flip, shared by every page. Two things make it worth its own file:
// the choice has to survive navigation between the landing page and the demos,
// and it has to be applied before first paint or the page flashes light.
const KEY = "mappo-theme";
const root = document.documentElement;

const apply = (t) => { if (t === "dark" || t === "light") root.dataset.theme = t; };
try { apply(localStorage.getItem(KEY)); } catch {}

export function bindThemeToggle(el) {
  if (!el) return;
  const label = () => {
    // Light unless asked otherwise: the stylesheet has no prefers-color-scheme
    // branch, so reading the OS here would put the button out of step with it.
    const dark = root.dataset.theme === "dark";
    el.textContent = dark ? "Light" : "Dark";
    el.setAttribute("aria-pressed", String(dark));
  };
  el.addEventListener("click", () => {
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    apply(next);
    try { localStorage.setItem(KEY, next); } catch {}
    label();
  });
  label();
}
