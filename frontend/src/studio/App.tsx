import { useEffect, useState } from "react";
import { api } from "../api";
import type { Meta } from "../types";
import { Home } from "./Home";
import { Studio } from "./Studio";

/** Two screens: the reels (#/) and the studio for one reel (#/reel/<id>). */
export function App() {
  const [route, setRoute] = useState(location.hash);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [down, setDown] = useState(false);
  useEffect(() => {
    const on = () => setRoute(location.hash);
    addEventListener("hashchange", on);
    api.meta().then(setMeta, () => setDown(true));
    return () => removeEventListener("hashchange", on);
  }, []);
  if (down) return <div className="home"><h2>The Reel API isn't running.</h2><p className="muted" style={{ marginTop: 8 }}>Start it with <span className="mono">uv run reel serve</span> in backend/, then reload.</p></div>;
  if (!meta) return null;
  const m = route.match(/^#\/reel\/([\w-]+)/);
  return m ? <Studio key={m[1]} id={m[1]} meta={meta} /> : <Home meta={meta} />;
}

export const go = (path: string) => (location.hash = path);
