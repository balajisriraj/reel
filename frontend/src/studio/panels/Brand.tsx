import { useRef, useState } from "react";
import { api, assetUrl } from "../../api";
import { rgbToHex, saturation } from "../../film/resolve";
import { FONTS } from "../../film/themes";
import type { Brand } from "../../types";
import { PanelHead, useStudio } from "../Studio";
import { Field, Icon, Section, Toggle, useToast } from "../ui";

const FONT_CHOICES: { value: Brand["font"]; label: string }[] = [
  { value: "theme", label: "Theme" },
  { value: "sans", label: "Sans" },
  { value: "serif", label: "Serif" },
  { value: "rounded", label: "Rounded" },
  { value: "condensed", label: "Condensed" },
  { value: "mono", label: "Mono" },
];

/** The two most vivid distinct colours in an image, skipping transparency, white and black. */
export async function logoColours(url: string): Promise<string[]> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await img.decode();
  const c = document.createElement("canvas");
  const w = (c.width = 96), h = (c.height = Math.max(1, Math.round((96 * img.height) / img.width)));
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h).data;
  const bins = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const [r, gg, b] = [data[i], data[i + 1], data[i + 2]];
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    // Only vivid pixels: skip near-black, near-white, greys and the dark edges where a mark meets its background.
    if (mx < 90 || mn > 225 || (mx - mn) / mx < 0.35) continue;
    const key = `${r >> 5},${gg >> 5},${b >> 5}`;
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bin.n++; bin.r += r; bin.g += gg; bin.b += b;
    bins.set(key, bin);
  }
  const colours = [...bins.values()].sort((a, b) => b.n - a.n).map((x) => rgbToHex(x.r / x.n, x.g / x.n, x.b / x.n));
  const picked: string[] = [];
  for (const col of colours) {
    if (picked.every((p) => Math.abs(parseInt(p.slice(1), 16) - parseInt(col.slice(1), 16)) > 0x202020)) picked.push(col);
    if (picked.length === 2) break;
  }
  return picked.sort((a, b) => saturation(b) - saturation(a));
}

export function BrandPanel() {
  const { project, update, refresh } = useStudio();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const b = project.brand;
  const set = (patch: Partial<Brand>) => update({ brand: { ...b, ...patch } });
  const logo = b.logo ? project.assets.find((a) => a.id === b.logo) : undefined;
  const images = project.assets.filter((a) => a.kind === "image");

  const upload = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try {
      const a = await api.uploadAsset(project.id, f);
      await refresh();
      const colours = await logoColours(assetUrl(project.id, a)).catch(() => []);
      set({ logo: a.id, ...(colours.length ? { colours: [colours[0], colours[1] ?? colours[0]], use_colours: true } : {}) });
      if (colours.length) toast("Logo added, and its colours are now the reel's accents");
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  const fromLogo = async () => {
    if (!logo) return;
    const colours = await logoColours(assetUrl(project.id, logo));
    if (!colours.length) return toast("That logo has no strong colours to take.", true);
    set({ colours: [colours[0], colours[1] ?? colours[0]], use_colours: true });
  };

  return (
    <>
      <PanelHead title="Brand" text="Your logo, colours, type and the marks that sit on every frame." />
      <div className="panel-body">
        <Section title="Logo">
          {logo ? (
            <div className="logo-prev">
              <div style={{ background: "#0b0b10" }}><img src={assetUrl(project.id, logo)} alt="" /></div>
              <div style={{ background: "#f4f2ee" }}><img src={assetUrl(project.id, logo)} alt="" /></div>
            </div>
          ) : (
            <div className="drop" onClick={() => file.current?.click()}><Icon name="upload" size={20} /><div style={{ fontWeight: 600, marginTop: 6 }}>{busy ? "Uploading…" : "Upload a logo"}</div><div className="small faint">A PNG or SVG with a transparent background works best</div></div>
          )}
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
          <div className="row wrap" style={{ marginTop: 8 }}>
            {logo && <button className="btn sm" onClick={() => file.current?.click()}>Replace</button>}
            {logo && <button className="btn sm" onClick={fromLogo}><Icon name="spark" size={13} /> Colours from logo</button>}
            {logo && <button className="btn sm ghost" onClick={() => set({ logo: "" })}>Remove</button>}
            {!logo && images.length > 0 && <span className="small faint">or pick one of your images:</span>}
            {!logo && images.slice(0, 6).map((a) => <button key={a.id} className="btn sm" onClick={() => set({ logo: a.id })} style={{ width: 54, background: `#111 center / contain no-repeat url(${assetUrl(project.id, a)})` }} title={a.name} />)}
          </div>
          <div className="card" style={{ padding: "2px 14px", marginTop: 12 }}>
            <div className="switchrow"><div><b>Intro sting</b><div className="small muted">The logo opens the reel</div></div><Toggle on={b.intro} onChange={(v) => set({ intro: v })} /></div>
            <div className="switchrow"><div><b>On the end card</b><div className="small muted">Above the call to action</div></div><Toggle on={b.outro} onChange={(v) => set({ outro: v })} /></div>
            <div className="switchrow"><div><b>Corner bug</b><div className="small muted">Small, in the corner of every frame</div></div><Toggle on={b.corner} onChange={(v) => set({ corner: v })} /></div>
          </div>
        </Section>

        <Section title="Colours">
          <div className="row">
            <input type="color" value={b.colours[0]} onChange={(e) => set({ colours: [e.target.value, b.colours[1] ?? e.target.value] })} aria-label="Primary" />
            <input type="color" value={b.colours[1] ?? b.colours[0]} onChange={(e) => set({ colours: [b.colours[0], e.target.value] })} aria-label="Secondary" />
            <span className="mono muted">{b.colours.join("  ")}</span>
            <span className="grow" />
            <Toggle on={b.use_colours} onChange={(v) => set({ use_colours: v })} label="Use brand colours" />
          </div>
          <p className="hint">{b.use_colours ? "Your colours are the accents: highlighted words, bars and the end card." : "Off: accents come from the theme or the palette you mixed."}</p>
        </Section>

        <Section title="Type">
          <div className="tiles c3">
            {FONT_CHOICES.map((f) => (
              <button key={f.value} className={`tile${b.font === f.value ? " on" : ""}`} onClick={() => set({ font: f.value })} style={{ textAlign: "center" }}>
                <span style={{ fontFamily: f.value === "theme" ? "var(--font)" : FONTS[f.value], fontWeight: 700, fontSize: 22 }}>Aa</span>
                <small>{f.label}</small>
              </button>
            ))}
          </div>
        </Section>

        <Section title="Watermark">
          <Field label="Text on every frame" hint="A credit, a handle, or “Draft: not for release”.">
            <input className="input" value={b.watermark.text} placeholder="@yourbrand" onChange={(e) => set({ watermark: { ...b.watermark, text: e.target.value } })} />
          </Field>
          <div className="row" style={{ alignItems: "flex-start", gap: 18 }}>
            <div>
              <span className="label">Corner</span>
              <div className="corner">
                {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map((p) => <button key={p} className={b.watermark.position === p ? "on" : ""} onClick={() => set({ watermark: { ...b.watermark, position: p } })} aria-label={p} />)}
              </div>
            </div>
            <div className="grow">
              <span className="label">Opacity {Math.round(b.watermark.opacity * 100)}%</span>
              <input type="range" min={0.15} max={1} step={0.05} value={b.watermark.opacity} onChange={(e) => set({ watermark: { ...b.watermark, opacity: Number(e.target.value) } })} />
            </div>
          </div>
        </Section>
      </div>
    </>
  );
}
