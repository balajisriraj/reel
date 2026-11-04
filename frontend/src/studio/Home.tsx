import { useEffect, useState } from "react";
import { api } from "../api";
import { fmtTime } from "../film/resolve";
import type { Meta, ProjectCard } from "../types";
import { go } from "./App";
import { Icon, Mark, useToast } from "./ui";

const STEPS = [
  ["Brief", "What it is, who it's for, the messages to land, the length and the shape."],
  ["Style", "Paste up to five videos you love. Reel measures their look; you mix and match."],
  ["Story", "Pick a narrative framework. The director writes every scene to your timing."],
  ["Render", "Add your media, brand and music. Scrub the live preview, then render the film."],
];

export function Home({ meta }: { meta: Meta }) {
  const [reels, setReels] = useState<ProjectCard[] | null>(null);
  const toast = useToast();
  useEffect(() => {
    api.projects().then(setReels);
  }, []);
  const create = async (sample: boolean) => {
    const p = await api.create(sample);
    go(`/reel/${p.id}`);
  };
  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete “${name}” and its renders?`)) return;
    await api.remove(id);
    setReels((r) => r?.filter((x) => x.id !== id) ?? null);
    toast("Reel deleted");
  };
  return (
    <div className="home">
      <div className="brand"><Mark /> Reel <span className="tag" style={{ marginLeft: 6 }}>{meta.director === "claude" ? meta.model : "scripted director"}</span></div>
      <div className="hero">
        <div>
          <h1>Product films,<br /><em>directed by AI.</em></h1>
          <p>Show Reel the films you admire and tell it what you need to say. It learns the look, writes the story to a proven structure, lands your key messages and renders the reel, with music cut to the beat.</p>
          <div className="row">
            <button className="btn primary lg" onClick={() => create(false)}><Icon name="plus" size={18} /> New reel</button>
            <button className="btn lg" onClick={() => create(true)}>Try the sample brief</button>
          </div>
        </div>
        <div className="steps4">
          {STEPS.map(([title, text], i) => (
            <div className="card" key={title}><span className="n">{i + 1}</span><b>{title}</b><span className="muted small">{text}</span></div>
          ))}
        </div>
      </div>
      {reels && reels.length > 0 && (
        <>
          <h3 className="muted small" style={{ textTransform: "uppercase", letterSpacing: ".08em" }}>Your reels</h3>
          <div className="projects">
            {reels.map((r) => (
              <div key={r.id} className="card project" role="button" tabIndex={0} onClick={() => go(`/reel/${r.id}`)} onKeyDown={(e) => e.key === "Enter" && go(`/reel/${r.id}`)} style={{ cursor: "pointer" }}>
                <div className="poster" style={r.poster ? { backgroundImage: `url(${r.poster})` } : undefined}>{!r.poster && <Icon name="camera" size={28} />}</div>
                <div className="meta">
                  <b>{r.name}</b>
                  <span className="muted small">{r.aspect} · {fmtTime(r.duration)} · {r.scenes ? `${r.scenes} scenes` : "no script yet"}</span>
                </div>
                <button className="btn icon sm del" title="Delete" onClick={(e) => { e.stopPropagation(); remove(r.id, r.name); }}><Icon name="trash" size={15} /></button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
