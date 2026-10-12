# 2513 Croton Ave walkthrough · handoff (side project, NOT part of Yireeb; never commit/push)

> 状态：进行中｜更新：2026-10-12｜位置：`playground/croton-house/`（未跟踪）。给用户的叔叔（Studio Hu Dwelling，建筑师/软装设计师，
> 小红书）做的 2513 Croton Ave, Sarasota 的照片级 three.js 第一人称漫游。用户要求：照片级真实、家具细节与照片一致、
> 花园要有设计感、可坐/可拖椅子/开门、GTA 风格小地图、Zillow 取景点与全景对照、小红书帖子取景点、中文优先双语、最后发布为私密链接。

## 接手指令
1. 预览服务：`.claude/launch.json` 里 `croton-house`（python http.server 8780，目录 `web/`）。`preview_start name=croton-house`。
2. 构建：`cd web && node tools/build.mjs`（esbuild → `dist/app.js`, `dist/showcase.js`）。
3. 截图：`node tools/shot.mjs "index.html?x=<plan x>&y=<plan y>&h=<heading deg>&p=<pitch>&eye=1.5[&dusk=1][&fast=1]" out.png`
   （系统 Chrome 无头；plan 坐标 +y 北）。单件家具：`showcase.html?module=<m>&item=<i>&az=&el=&dist=`。
4. 与 Zillow 全景逐点对照：`python3 -I tools/compare.py [panoId…]` → `compare/<id>_<title>.jpg`（左实拍右模型）。
5. 数据：`web/data/house.json`（由 `tools/parse_plan.mjs` 从 `source/zillow/floor_shape.svg` 生成，米制，+y 北，three.js z=-y）、
   `floorplan_points.json`（14 全景 + 28 照片的平面位置/朝向，百分比对 viewBox）、`tour.json`（全景链接角）、`gallery_order.json`、
   `rednote_posts.json`。资源：`web/assets/{photos,panos}`→软链到 `source/zillow`；`assets/tex`（Poly Haven CC0 2k）、`hdr`、`rednote`。
6. 代码：`src/main.js` 场景/灯光/后期；`house.js` 墙体门窗屋顶院子；`layout.js` 家具摆位表（PLACEMENTS）；`furniture/*.js`
   各区域模块（由 Opus 子会话建模，每个有 `items` 导出；`decor_plus.js` 包装 decor）；`player.js` 走/坐/碰撞；`interact.js`
   坐/拖/门；`minimap.js` GTA 小地图；`viewpoints.js` 取景点飞行+对比滑块+全景球（TRIM 为逐全景朝向修正）；`rednote.js`；
   `tour.js`；`human.js`（Yireeb 方块人坐姿）；`ui.js` i18n。
7. 子会话简报：`BRIEF.md`；参考图：`refs/<area>/`。

## 现状（2026-10-12 深夜更新）
- 已修：地面白色闪烁（stem wall 顶面与地板共面，已下沉）；室内改 RoomEnvironment+暖色半球光；室内墙改平涂；厨房按全景改为
  `southRunB`/`westRunB`（炉灶在西墙）；客厅沙发靠东墙朝西、红画在小凳上；厨房/家庭室之间是矮墙+白桌；院子按航拍重做并用
  `generatePlanting()` 密植（layout.js）；黄昏模式灯具真正亮起（材质 envMapIntensity 随时段）；卫生间镜柜用 Reflector 真反射；
  玩家碰撞半径 0.17；坐姿方块人缩 0.82。
- 已验证（tools/playtest.mjs）：走动、坐沙发/起身、拖 Y 椅、开落地门、大地图、取景点/小红书面板、照片对比滑块、全景模式、黄昏、导览。
- Codex（tmux 会话 `croton`，codex_work）在做 `tools/package.py`（打包到 `build/`，贴图降 1k）和手机布局（只改 style.css/ui.js/index.html）。
- 旧现状：
- 8 个家具模块全部完成并通过 showcase 截图核对；厨房正在改为全景所示布局（`southRunB`/`westRunB`，待交付后在 layout 里替换）。
- 室内用 RoomEnvironment 照明 + 太阳阴影 + GTAO；室外按航拍 g50 重做了院子（覆盖物床、贝壳砾石休息区+木边、院墙、东侧木栅栏）。
- 对照表已看：玄关/餐厅/家庭室/主卧基本吻合；客厅沙发已改到东墙朝西；厨房炉灶应在西墙（等子会话）。
- 用户反馈过：地面穿模、操作不顺（已加自适应画质、dt 上限 0.1）、花园难看（已重做，继续打磨）、未显示空间也要合理（车库/洗衣间已建）。

## 待做
- 看剩余对照（走廊/卧室/卫生间/露台/后院）并修；厨房新 run 到位后更新 `layout.js`。
- 在浏览器实际验证：坐下、拖椅子、开门、小地图大图、取景点面板、全景模式、小红书面板、导览、黄昏模式、手机布局。
- 发布：贴图降到 1k 以控制体积（artifact 上限），发布为私密 artifact 链接。
