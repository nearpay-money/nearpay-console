/** A tiny History-API router (nginx serves index.html for every path). */

export interface Match {
  readonly name: string;
  readonly params: Readonly<Record<string, string>>;
}

export interface RouteSpec {
  readonly name: string;
  readonly pattern: string;
}

/** Matches `/merchants/:id` style patterns; returns null when nothing matches. */
export function matchPath(routes: readonly RouteSpec[], pathname: string): Match | null {
  const clean = pathname.replace(/\/+$/, "") || "/";
  for (const r of routes) {
    const ps = r.pattern.split("/");
    const xs = clean.split("/");
    if (ps.length !== xs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i] as string;
      const x = xs[i] as string;
      if (p.startsWith(":")) {
        if (!x) {
          ok = false;
          break;
        }
        try {
          params[p.slice(1)] = decodeURIComponent(x);
        } catch {
          ok = false;
          break;
        }
      } else if (p !== x) {
        ok = false;
        break;
      }
    }
    if (ok) return { name: r.name, params };
  }
  return null;
}

export type Mode = "live" | "test";

/** The console's working mode from `?mode=` (default live: operators mostly work on live money). */
export function modeFromSearch(search: string): Mode {
  return new URLSearchParams(search).get("mode") === "test" ? "test" : "live";
}

/** Adds `?mode=test` to an in-app path when in test mode (live is the default, kept out of URLs). */
export function hrefFor(path: string, mode: Mode): string {
  const [p, q = ""] = path.split("?") as [string, string?];
  const sp = new URLSearchParams(q);
  if (mode === "test") sp.set("mode", "test");
  else sp.delete("mode");
  const s = sp.toString();
  return s ? `${p}?${s}` : p;
}
