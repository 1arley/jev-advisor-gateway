# README overview video

`jev-advisor-gateway-overview.mp4` is a 14-second, 1280 × 720 H.264 overview. The composition
uses synthetic labels and contains no session data or audio. `overview-poster.png` is its still
frame.

The README embeds `overview.gif` because neither GitHub nor npm animates a linked MP4 in Markdown.
The GIF is a 640 × 360, 15 fps, 128,000-color-palette render of the same video, click-through to the
MP4. Regenerate it whenever the MP4 changes:

```bash
ffmpeg -y -i media/jev-advisor-gateway-overview.mp4 \
  -vf "fps=15,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=5" \
  -loop 0 media/overview.gif
```

The editable Remotion composition is `Composition.tsx`. To recreate it from the repository root,
create a blank project in a unique temporary directory, replace its `src/Composition.tsx` with this
file, then render:

```bash
project_dir="$(mktemp -d)/jev-advisor-overview"
npx create-video@latest --yes --blank "$project_dir"
cp "$PWD/media/Composition.tsx" "$project_dir/src/Composition.tsx"
cd "$project_dir"
npx remotion render GatewayOverview out/jev-advisor-gateway-overview.mp4 --codec=h264 --crf=23 --pixel-format=yuv420p
npx remotion still GatewayOverview --frame=130 --output=out/overview-poster.png
```

The composition is 420 frames at 30 fps (14 seconds). Frame 130 is the current poster because it
shows the tool-selection example. If you change beat timings, render a new poster from a frame that
represents the revised video, and update the MP4 and poster together.

The video uses synthetic labels only. Do not use screenshots or session data in it.

The initial render used the `create-video@latest` template with Remotion 4.0.539. Its temporary
dependency tree reported 10 high-severity `npm audit` findings on 2026-10-28. The scaffold was not
added to the gateway; check the current audit before recreating the video. This repository does not
depend on Remotion at runtime.
