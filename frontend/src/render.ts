// The render page: the film alone, at full size, for the renderer to step through frame by frame.
//   render.html?project=<id>&api=<origin>
// It exposes window.READY (a promise), window.TIMELINE and window.renderAt(t).
import { api, assetUrl, setApiBase } from "./api";
import { Film } from "./film/engine";
import { buildTimeline, resolveLook, type Timeline } from "./film/resolve";

declare global {
  interface Window {
    READY: Promise<void>;
    TIMELINE: Timeline | undefined;
    renderAt: (t: number) => Promise<void>;
  }
}

const params = new URLSearchParams(location.search);
if (params.get("api")) setApiBase(params.get("api")!);
const id = params.get("project") ?? "";

window.READY = (async () => {
  const project = await api.project(id);
  const look = resolveLook(project);
  const timeline = buildTimeline(project, look);
  const film = new Film(document.getElementById("film")!, project, look, timeline, { mode: "render", assetUrl: (a) => assetUrl(project.id, a) });
  await film.ready();
  await film.renderAt(0);
  window.renderAt = (t) => film.renderAt(t);
  window.TIMELINE = timeline;
})();
