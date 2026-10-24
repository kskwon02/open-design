# Muda 推理性能宣传片

从 `example.html` 开始制作；这是完整可编辑影片。所有画面由一个 Canvas 重建，GSAP 仅驱动统一时钟。

**Arc:** 等待 → 划掉等待 → 浪费 → 利用率 → 词元流 → 名称释义 → 宣言 → 品牌 → 计时回执

参考资源：`references/sound.json` 只包含原片声音结构，不含原片音频。运行资源：`assets/gsap.min.js`、`assets/inter-regular.woff2`、`assets/inter-bold.woff2`、`assets/inter-black.woff2`、`assets/mono.woff2`、`assets/inter-OFL.txt`、`assets/mono-OFL.txt`。`assets/cover.jpg` 是模板渲染的封面。

| Scene (`CFG.scenes` id) | Dur | Summary | Build | Reuse |
|---|---|---|---|---|
| `wait` | 3.000 秒 | 聊天气泡逐字输入，等待条扫光，计时加速并在尾部错位。 | Canvas；`question-type` 驱动进入；`wait-glitch` 从结束倒数 0.566666667 秒，以 30 Hz 改变水平切片与紫色扫描条 | `prompt` |
| `word` | 1.000 秒 | 巨大 WAITING 被紫线横向划掉。 | Canvas；`word-in` 驱动进入，三次缓出，尾部 cue 绑定场景结束 | `waitingWord` |
| `waste` | 0.500 秒 | 紫底白字 WASTE. 硬切反转。 | Canvas；`waste-in` 驱动进入，三次缓出，尾部 cue 绑定场景结束 | `wasteWord` |
| `cluster` | 4.500 秒 | 320 个方格逐格生成，四种浪费标签出现，彩色扫描把利用率从 31% 提升到 94%。 | Canvas；`grid-in` 驱动进入，三次缓出，尾部 cue 绑定场景结束 | `clusterLine`、`resolvedLine` |
| `stream` | 4.000 秒 | 彩色词元胶囊横流加速，中央卡片显示 12,480 tok/s 和 38 ms。 | Canvas；`stream-in` 驱动进入，三次缓出，尾部 cue 绑定场景结束 | `throughput`、`firstToken` |
| `name` | 4.000 秒 | 圆相笔触绘出，muda 的词典释义、丰田生产方式说明和结论逐项出现。 | Canvas；`enso-in` 驱动进入，三次缓出，尾部 cue 绑定场景结束 | `brand`、`definition`、`contextLine`、`alsoLine` |
| `claim` | 3.500 秒 | 两行宣言逐词出现，右侧日文竖排，尾部切片扰动。 | Canvas；`claim-in` 驱动进入，三次缓出，尾部 cue 绑定场景结束 | `claim`、`claimSecond`、`japanese` |
| `mark` | 2.500 秒 | 斜切渐变带展开，muda. 粗体品牌字和标语落位。 | Canvas；`ribbon-in` 驱动进入，三次缓出，尾部 cue 绑定场景结束 | `brand`、`tagline` |
| `receipt` | 3.053 秒 | 26.000 s 与 0.038 s 对照，说明文字出现后切到小品牌字。 | Canvas；`film-time` 驱动进入，三次缓出，尾部 cue 绑定场景结束 | `brand`、`firstToken`、`receiptLine` |

片尾 `final-done` cue 从结束倒数 0.35 秒显示 `done.`；`stream-transition` 从结束倒数 0.05 秒切出。

## Adapting the template

所有文字、颜色、字体与两个性能终值都从 `CFG` 读取，输入声明与默认值保持同步。重要元素的稳定句柄是变量 id、scene id 和 cue id；Canvas 内部没有独立 DOM 节点。
- `wait`：可替换 `prompt`；保留「聊天气泡逐字输入，等待条扫光，计时加速并在尾部错位。」的动作关系。范围 3–4.5 秒；加长时将时间留在入场与尾部 cue 之间。延长期间由旋转等待圈、扫光占位条和持续计时维持运动。`wait-glitch` 保持从结束倒数 0.566666667 秒；聊天气泡、Thinking、占位条和计时数字在尾段发生逐帧水平切片，勿改回整组抖动。`prompt` 最长 34 字符。超长文案先改短，不降低可读字号。此场不是任意条目列表；若提供更多信息，只选择最强的一项，减少条目时保留原有主动作，切勿复制更多面板。
- `word`：可替换 `waitingWord`；保留「巨大 WAITING 被紫线横向划掉。」的动作关系。范围 1–1.5 秒；加长时将时间留在入场与尾部 cue 之间。延长期间由大字的轻微呼吸与底部时间进度维持运动。`waitingWord` 最长 7 字符。超长文案先改短，不降低可读字号。此场不是任意条目列表；若提供更多信息，只选择最强的一项，减少条目时保留原有主动作，切勿复制更多面板。
- `waste`：可替换 `wasteWord`；保留「紫底白字 WASTE. 硬切反转。」的动作关系。范围 0.5–0.5 秒，锁定时长。延长期间由白字的细微漂移与底部时间进度维持运动。`wasteWord` 最长 6 字符。超长文案先改短，不降低可读字号。此场不是任意条目列表；若提供更多信息，只选择最强的一项，减少条目时保留原有主动作，切勿复制更多面板。
- `cluster`：可替换 `clusterLine`、`resolvedLine`；保留「320 个方格逐格生成，四种浪费标签出现，彩色扫描把利用率从 31% 提升到 94%。」的动作关系。范围 4.5–6.5 秒；加长时将时间留在入场与尾部 cue 之间。延长期间由方格透明度缓慢呼吸和持续时间码维持运动。`clusterLine` 最长 38 字符；`resolvedLine` 最长 22 字符。超长文案先改短，不降低可读字号。此场不是任意条目列表；若提供更多信息，只选择最强的一项，减少条目时保留原有主动作，切勿复制更多面板。
- `stream`：可替换 `throughput`、`firstToken`；保留「彩色词元胶囊横流加速，中央卡片显示 12,480 tok/s 和 38 ms。」的动作关系。范围 4–6 秒；加长时将时间留在入场与尾部 cue 之间。延长期间由词元持续横向流动，终值留读维持运动。本场没有长文槽位。超长文案先改短，不降低可读字号。此场不是任意条目列表；若提供更多信息，只选择最强的一项，减少条目时保留原有主动作，切勿复制更多面板。
- `name`：可替换 `brand`、`definition`、`contextLine`、`alsoLine`；保留「圆相笔触绘出，muda 的词典释义、丰田生产方式说明和结论逐项出现。」的动作关系。范围 4–6 秒；加长时将时间留在入场与尾部 cue 之间。延长期间由圆相与大汉字缓慢漂移维持运动。`brand` 最长 6 字符；`definition` 最长 36 字符；`contextLine` 最长 100 字符；`alsoLine` 最长 35 字符。超长文案先改短，不降低可读字号。此场不是任意条目列表；若提供更多信息，只选择最强的一项，减少条目时保留原有主动作，切勿复制更多面板。
- `claim`：可替换 `claim`、`claimSecond`、`japanese`；保留「两行宣言逐词出现，右侧日文竖排，尾部切片扰动。」的动作关系。范围 3.5–5 秒；加长时将时间留在入场与尾部 cue 之间。延长期间由右侧竖排文字轻微漂移维持运动。`claim` 最长 21 字符；`claimSecond` 最长 25 字符；`japanese` 最长 8 字符。超长文案先改短，不降低可读字号。此场不是任意条目列表；若提供更多信息，只选择最强的一项，减少条目时保留原有主动作，切勿复制更多面板。
- `mark`：可替换 `brand`、`tagline`；保留「斜切渐变带展开，muda. 粗体品牌字和标语落位。」的动作关系。范围 2.5–4 秒；加长时将时间留在入场与尾部 cue 之间。延长期间由渐变色团持续漂移维持运动。`brand` 最长 6 字符；`tagline` 最长 38 字符。超长文案先改短，不降低可读字号。此场不是任意条目列表；若提供更多信息，只选择最强的一项，减少条目时保留原有主动作，切勿复制更多面板。
- `receipt`：可替换 `brand`、`firstToken`、`receiptLine`；保留「26.000 s 与 0.038 s 对照，说明文字出现后切到小品牌字。」的动作关系。范围 3.052789–4.5 秒；加长时将时间留在入场与尾部 cue 之间。延长期间由数字和小品牌字轻微呼吸维持运动。`brand` 最长 6 字符；`receiptLine` 最长 44 字符。超长文案先改短，不降低可读字号。此场不是任意条目列表；若提供更多信息，只选择最强的一项，减少条目时保留原有主动作，切勿复制更多面板。

拉长场景时，`dur > minDur` 会叠加可持续的轻微整体漂移，避免等待段冻结；默认时长不启用这层漂移。

更改总时长时，优先由 `name`、`cluster`、`stream` 吸收，其次 `mark` 与 `claim`；`waste` 不变。`CFG.duration` 必须等于各 dur 之和，场景起点自动累加；所有退出与转场 cue 保持 `from: "end"`。时间码和进度线始终推进。原片固定性能数字并非真实产品承诺，适配时由使用者提供自己的数据。

## Sound

`assets/soundtrack.mp3` ships as the demo soundtrack, added by the runner.
The demo track is the reference film's own soundtrack.
When the film length changes, refit or replace the track using references/sound.json (bpm, sections).

The bundled track is demo material, not a requirement for generated films.
The user's current brief takes priority over this reference and its seed prompt,
including duration, music choice, genre, mood, voiceover and sound effects.
Follow the general motion-design audio guidance; this template does not disable
available audio tools or original audio synthesis.

- If the user requests a silent film, remove all audio. If they request only
  no background music, remove the music but retain any requested sound effects
  or voiceover. No voiceover does not mean no music.
- Use the user's supplied audio when requested. If they request different music,
  choose or create a suitable real local asset using the available audio tools,
  licensed sources or original synthesis. Do not silently substitute the demo
  track for an unmet request; briefly disclose any limitation.
- Without a specific music request, add appropriate audio when it benefits the
  film. Reuse the demo track only when it suits the actual story, mood and timing;
  it is an option, not the default for every adaptation.
- Fit the visuals and audio to the requested film duration, not to the demo's
  duration. For example, a 15-second brief stays 15 seconds even when the demo
  score is 20 seconds. Edit the selected track with a deliberate ending/fade;
  use the same edited local file in HTML and MP4. For a longer film, arrange or
  replace the track to cover the intended beats rather than leaving an accidental
  silent tail. Do not rely on an HTML-only loop or playbackRate for export.

For background music keep `id="soundtrack"`, `data-start="0"` and a numeric
`data-volume`; update `src` and `data-duration` to the actual edited asset and
film. Remove unused demo audio from the generated composition. Set the source's
`od-motion-audio` metadata to `required` when sound is intended, or `silent` for
an intentionally silent film, using the general motion-design delivery guidance.
Verify the ending and audio in both HTML playback and the exported MP4.

The `<audio>` element stays inside the composition root; the desktop exporter
mixes its local file into the MP4. Preview sound starts with the film; when the
browser blocks autoplay, the first click or key press turns it on, and Sound off
mutes it. Sound follows the master timeline, including pause and backward
seeks. Keep it silent during frame capture and in sandboxed gallery thumbnails.

## 来源

参考发布链接：https://x.com/deedydas/status/2102787937482252537 ，发布者 @deedydas，画面品牌 muda。未抓取网页。图形均为新写 Canvas 指令；不包含原片帧或抠图；原片音轨由 runner 加入，作为示例音轨。
