# 微信小程序端（原生）

AppID：`wxd1742cec14ff6355`｜接口域名：`https://api.mixyj.cn`｜音频域名：与后端 `.env` 的 `COS_CDN_DOMAIN` 一致（标准 COS 的 bucket 默认访问域名；日后启用自定义域名/CDN 则填该域名）

## 1. 导入

1. 微信开发者工具 → 导入项目 → 选择本 `miniprogram/` 目录，AppID 已写在 `project.config.json`。
2. 建议基础库选较新版本（3.x）。
3. 本地联调可勾选「不校验合法域名」（`project.config.json` 的 `urlCheck: false` 只影响开发者工具）。
4. **真机预览 / 体验版必须在 mp 后台配置合法域名**：
   - `request`：`https://api.mixyj.cn`
   - `downloadFile`：与后端 `.env` 的 `COS_CDN_DOMAIN` 一致
     - 路径 A（bucket 默认访问域名）：`https://<Bucket-Appid>.cos.<Region>.myqcloud.com`（必须填完整 host；微信不支持父域名/泛域名，地域根域名不能替代）
     - 路径 B（挂载 + 自有域名）：`https://cos.mixyj.cn`
   - 服务端证书必须是系统信任的有效证书（**不支持自签**）、域名匹配、信任链完整、TLS 1.2+；nginx 现成配置见 `deploy/nginx/api.mixyj.cn.conf`，步骤见 `backend/README.md` 第 2 节「域名与 HTTPS」
   - **换桶后必须把新 host 加进 `downloadFile` 合法域名**（旧 host 建议并存一段时间，见 `backend/README.md` 第 2 节「换桶 / 从轻量存储迁到标准 COS」）
   - 两条路径详见 `backend/README.md` 第 2 节；音频 `src` 走 `downloadFile` 合法域名，封面走 `<image>` 组件（通常不校验合法域名）
5. `app.json` 已声明 `requiredBackgroundModes: ["audio"]`，开发版/体验版直接生效，正式版需审核。

## 2. 目录

```
config/brand.js          ★ 品牌唯一来源：站名 / 副标题 / 锁屏来源 / 页面标题 / tabBar / 主色 / Logo / 徽章文案 / 空态文案
config/brand.wxss        由 sync-brand 生成的 CSS 变量（勿手改），app.wxss 已 @import
scripts/sync-brand.js    品牌同步脚本：把 brand.js 写进 app.json / 各页 json / project.config.json / brand.wxss
services/config.js       接口地址、定时档位、缓存键、setShutdown 单位配置
services/api.js          request 封装：统一响应、Bearer token、401 自动重新登录
services/auth.js         wx.login → code2session → token，并发去重
services/catalog.js      专辑/音频列表，按 catalog_version 版本戳缓存 + 弱网降级
services/history.js      播放进度上报 / 历史列表 / 删除
services/player.js       ★ 后台音频单例、唯一播放状态源、切歌与进度上报
services/sleep-timer.js  定时关闭：原生 setShutdown + JS 前台兜底
services/play-events.js  v0.12 收听事件本地队列 + 批量幂等上报（旁路，v0.12.1 保留）
services/stats.js        v0.12 GET /me/stats 聚合数据
utils/badges.js          v0.12.2 8 枚徽章亮/暗判定规则；文案读 config/brand.js
utils/heatmap.js         v0.12 热力格纯函数（v0.12.1 起页面不再引用，待清理）
pages/index              首页（tabBar）：纯 CSS 品牌徽标 + 专辑列表
pages/album              专辑内音频列表
pages/player             播放页 + 定时关闭
pages/history            最近播放 + 续播（tabBar）
pages/mine               「我的」：成绩单 / 成就徽章（亮暗达成状态 + 8 枚图标）/ 专辑完成度 / 工具（tabBar）
components/mini-player   全局悬浮播放条
tests/player-sync.test.js 播放器 / 微信音频条联动回归测试（纯 Node，无依赖）
tests/mine-module.test.js 「我的」模块 + 品牌配置同步回归测试（纯 Node，无依赖，18 条）
```

## 3. 关键实现

### 换品牌 / 换项目：只改 `config/brand.js`（v0.13）

站名、副标题、锁屏来源名、各页导航栏标题、tabBar 三项文案与配色、主色、Logo 形态、8 枚徽章的名称/条件/差距文案、全部空态文案，统一收在 `config/brand.js`。改完执行一次同步脚本，再重新编译：

```bash
node miniprogram/scripts/sync-brand.js
```

脚本只覆盖品牌相关字段（其余配置原样保留），产出四类东西：

| 生成目标 | 内容 |
| --- | --- |
| `app.json` | 全局标题（站名）、窗口底色、tabBar 文案 / 选中色 / 底色 |
| `pages/*/*.json` | 各页 `navigationBarTitleText`（首页固定用站名） |
| `project.config.json` | `description` |
| `config/brand.wxss` | 主色等 CSS 变量（`app.wxss` 已 `@import`，各页与 mini-player 用 `var(--brand-primary)`） |

- **为什么需要脚本**：app.json / 页面 json / WXSS 都不能 `require` JS，tabBar 文案、导航标题、主题色只能落成字面量，脚本负责从品牌配置生成它们。
- **漏跑会立刻暴露**：`tests/mine-module.test.js` 的「品牌配置与静态文件同步」用例会重跑生成器做对比，不同步直接失败；另有「业务代码不得硬编码品牌名」的静态扫描。
- **Logo 两种形态**：`logo.type='mark'`（默认）用 `index.wxss` 的纯 CSS 徽标；`type='image'` 时改读 `logo.image`（建议 PNG，放 `assets/` 填相对路径）。
- **派生值不用手写**：`tabs[0]` 用 `{name}` 占位、`colors.tabTextActive` 自动跟随 `primary`、徽章墙副标题由「亮 / 暗」两条文案拼出。
- **换项目的边界**：AppID、工程目录名、页面路径、tabBar 项顺序属于工程结构，仍在 `project.config.json` / `app.json` 里改；微信公众平台的名称需在后台另改（涉及主体审核）。

### 品牌「枕书」与「我的」页边界（v0.12.3）

- 首页 tab 与全站可见文案统一为**枕书**（原「书库」）；`app.json` 全局标题、各页空态引导、清缓存提示、锁屏面板 `BGM.singer` 同步。v0.13 起这些文案全部取自 `config/brand.js`，业务代码里不再出现字面量。AppID、工程目录名 `listen-book`、页面路径与 tabBar 三项顺序均不变；微信公众平台上的小程序名称需另行在后台修改（涉及主体审核，本次不动）。
- 首页徽标由 `pages/index/index.wxml` + `.wxss` 的 8 个 `view` 纯 CSS 绘制（一弯月 / 一卷书 / 一枕），不引入 PNG / SVG / 字体；与徽章墙的 WXSS 几何图标同一套取舍。
- **「我的」页不再展示「最近播放」模块的内容**：`GET /me/stats` 仍返回 `last`，但前端不再消费，也不再有「继续收听」卡片与 `onContinue()`；续播完整保留在「最近」tab。`onShow()` 的 `player.reconcile()` 仍执行，保证 mini-player 与微信音频条一致。服务端零改动。

### 后台播放

`wx.getBackgroundAudioManager()` 全局单例，在 `app.js onLaunch` 初始化并注册事件。切歌统一走 `player.play(index, startAt)`，先写 `title/epname/singer/coverImgUrl/startTime`，**最后**赋 `src`（赋值即播放）。`app.json` 的 `requiredBackgroundModes: ["audio"]` 不能删。

### 上一首 / 下一首

| 入口 | 处理 |
| --- | --- |
| 页面按钮、mini-player | `player.prev()` / `player.next(false)` |
| 锁屏面板、系统音乐面板、耳机线控 | `BGM.onPrev` / `BGM.onNext` |
| 播完自动连播 | `BGM.onEnded` → `next(true)`（最后一首自然结束，不调 API） |
| 播放出错 | 自动跳下一首，连续 3 次失败后停止 |

### 与微信音频条的联动（v0.11）

小程序最小化后，微信顶部音频条 / 锁屏面板仍在控制同一个 `BackgroundAudioManager` 单例；官方文档明确 `onTimeUpdate` **只有小程序在前台时回调**，后台期间的 `onPlay` / `onPause` 也可能因 JS 被挂起而丢失，因此本地 `state.isPlaying` 不能当权威状态。

| 手段 | 说明 |
| --- | --- |
| `BGM.paused` 为准 | `toggle()` / `bgmIsPlaying()` 直接读微信权威状态，避免按钮做反操作 |
| `player.reconcile()` | `app.onShow`、最近播放页 `onShow`、播放页 `onShow` 回到前台时对齐 `isPlaying` / `currentTime` / 曲目录，并补报一次进度 |
| 起播窗口保护 | 刚赋新 `src` 的几秒内微信 `currentTime` 可能是 0，此窗口内不对账，避免覆盖 `startTime` 指定的起播进度 |
| 暂停恢复 | 同一首被暂停时只调 `BGM.play()`，不重赋 `src`、不 `seek`，进度与音频条保持连续 |
| 冷启动恢复 | `lb_player` 缓存播放列表 / 游标；小程序被回收后音频仍在播时，`reconcile()` 自动把游标对齐到 BGM 正在播的那首 |
| 进度不倒退 | 上报用 `state.currentTime`（`stop()` 后 `BGM.currentTime` 可能归零）；最近播放列表对当前曲目直接显示 BGM 实时位置 |

### 定时关闭（**上线前必须做真机探针**）

| 模式 | 实现 | 后台/锁屏可靠性 |
| --- | --- | --- |
| 不开启 | `setShutdown('none')` | — |
| 15 / 30 / 60 / 自定义分钟 | `setShutdown('timer', time)` 原生计时 + 前台 `setInterval` 兜底 + `App.onShow` 补偿 | 取决于 `setShutdown` 是否可用 |
| 播完当前这首停止 | **只设标志**，`onEnded` 时不切下一首 | ✅ 100% 可靠（不调用任何播放 API） |

**自动连播与定时的关系**：专辑列表由 `album.js` 的 `setPlaylist()` 一次性灌入（会拉完所有分页），`onEnded` 里按顺序执行「定时到点检查 → 播完当前标志 → `next(true)` 连播下一集」，三者优先级依次递减，定时不会被连播覆盖。倒计时分钟数仍由原生 `setShutdown` + 前台 `setInterval` + `App.onShow` 补偿负责；曲末那次 `check()` 是锁屏期间 JS 定时器被冻结时的兜底，最晚延迟到当前这首播完才停。连播范围仅限**同一专辑内按 `sort_order`**，最后一集播完停止，不跨专辑。

**为什么要探针**：微信官方文档只给出 `setShutdown('none'|'timer'|'autoNext', time)` 签名，没有 `time` 的单位说明，连 `miniprogram-api-typings` 里都没有该方法的类型定义。代码做了 `typeof bgm.setShutdown === 'function'` 能力探测，不可用时界面会明确提示「锁屏后定时可能不生效」，不会静默假装成功。

探针步骤（首次真机调试做一次）：

```js
// 开发者工具控制台 / 真机调试
const b = wx.getBackgroundAudioManager();
console.log('setShutdown:', typeof b.setShutdown);
// 播放任意音频后，设 1 并观察：是 1 秒后停（单位=秒）还是 1 分钟后停（单位=分钟）
b.setShutdown('timer', 1);
```

结论只改一处：`services/config.js` 的 `SHUTDOWN_TIME_UNIT` 改成 `'second'` 或保持 `'minute'`。若 `typeof` 输出 `undefined`，说明该基础库不提供此 API，请优先使用「播完当前」模式，并在产品上说明限制。

### 播放历史

- 冷启动 `wx.login → /api/v1/auth/login` 拿 Sanctum token；`api.js` 在 401 时自动重新登录并重放请求。
- 进度上报：`onTimeUpdate` 每 20s 节流一次，切歌 / 暂停 / 页面 `onHide`/`onUnload` 时补报；失败静默不打断播放。
- 续播：历史页点「继续播放」，**若微信音频条上就是这一首**，则不重建列表、不重赋 `src`、不 `seek` 回服务端旧进度，正在播只打开播放页，被暂停则从 BGM 实时位置续播；是别的曲目才拉取该专辑完整列表 → `player.play(index, progressSec)` → `bgm.startTime` 生效。
- **官方限制**：`onTimeUpdate` 只有小程序在前台时回调，因此后台播放期间的进度不会实时回写，回到前台后会补偿上报；列表对当前曲目用 BGM 实时位置覆盖服务端旧值。

### 「我的」页面与成就徽章（v0.12.2）

- **页面区块**（自上而下）：继续收听大卡片 → 收听成绩单（3 指标）→ 成就徽章墙 → 专辑完成度 → 工具区。**v0.12.1 起已移除「真实收听」区块**（累计收听 / 连续收听天数 / 近 12 周热力格与全部口径文案），页面不得再出现这些字样。
- **两套时长口径仍分离、但只展示一套**：`累计听完` = 已听完集数的内容总长（来自 `play_histories`），页面只展示它；`累计收听` = 真实播放秒数（来自 `play_events`），仍由 `GET /me/stats` 返回但**前端不再消费**（CR-01 / Q-11：展示层裁剪，数据链路保留）。
- **成就徽章（v0.12.2 / CR-02）**：「亮 / 暗」只表示**成就状态**——达成即亮（彩色渐变章面 + 白色线性图标 + 白色内环 + 光晕 + 弹入 + 100% 进度），未达成即暗（灰阶图标 + 虚线环 + 进度条与「还差 N」）。**页面固定浅色主题，不提供任何明暗模式切换**，与系统深色模式无关。8 枚语义化图标：`book` 翻开的书 / `steps` 阶梯 / `stack` 书堆 / `check` 圆环对勾 / `scroll` 卷轴 / `trophy` 奖杯 / `headphone` 耳机 / `sail` 帆船，全部由 WXSS 纯 CSS 几何绘制（`--ink` 随亮暗换色），不依赖图片、字体、伪元素。标题行显示「N / 8 已点亮」与「达成即点亮」。完整视觉规范见 `docs/我的模块/需求澄清记录_成就徽章_v1.2.md`。
- **徽章规则**：全部取自成绩单 / 完成度中看得见的字段（`finished_tracks` / `finished_content_sec` / `listened_albums` / `history_count` / `max_finished_track_sec` / `albums[]`）；「十小时俱乐部」按**累计听完** 10 小时判定，原「三日不辍」替换为「书海漫游」（听过 8 张专辑）。`total_listen_sec` / `streak_days` 不参与任何判定；点击任意徽章用 toast 提示条件与状态/差距。
- **事件采集是旁路且仍保留**：`services/play-events.js` 把事件写进 `lb_play_events` 本地队列（上限 500 条），按 ≤ 50 条批量 POST `/me/play-events`，`client_event_id` 保证幂等；失败静默保留，下次成功时补报。`player.js` 只在既有节点打点，不重写 v0.11 状态机。v0.12.1 页面不再展示这些数据，但表、接口与打点**零改动**。

| 播放节点 | 事件 | 服务端含义 |
| --- | --- | --- |
| 起播 / 切歌 / 重听 | `start`（换新会话） | 只建立位置基准，不计时长 |
| 前台 20 秒节流点 | `tick` | 累计位置前进的部分 |
| 播完一集 | `ended` | 结算到曲目末尾 |
| 拖动进度条 / 暂停后恢复 | `start`（不换会话） | 重置基准，跳变与暂停期间不计入 |
| 回前台 `reconcile()` | `catchup` | 补记后台播放，按 `min(经过时间, 曲目剩余时长)` 截断 |

- **后端口径（页面已不展示）**：连续天数按北京时间自然日算，当日有效收听满 1 分钟算一天；跨自然日的收听段由服务端拆分到两天；用户身份只由 token 推导。`daily[]` 等字段保留返回，供后续决定是否恢复展示。
- **清理**：「清空播放历史」会在服务端连带清空 `play_events`（成绩单与全部徽章同步归零）；「清空本地缓存」保留 `lb_token`、`lb_sleep`、`lb_player`、`lb_play_events` 待报队列，只清枕书等缓存（v0.12.2 起无主题偏好键）。
- **上线前提**：v0.12 后端必须先执行 `php artisan migrate`（新增 `play_events` 表）+ `php artisan optimize:clear`；**上线前的历史收听不回填**。**v0.12.1 是纯前端变更**：只需小程序重新编译上传，服务端不用 migrate、不用清缓存、不用改 `.env`；**v0.12.2 同样是纯前端变更**，只需重新编译上传；若确认永久不再使用 `play_events`，再按 Q-11 单独下线采集链路。

### 本地回归测试

不需要微信开发者工具，直接跑模拟测试（用假 BGM / 假请求复现关键链路）：

```bash
node miniprogram/tests/player-sync.test.js   # 11/11
node miniprogram/tests/mine-module.test.js   # 18/18
```

- `player-sync.test.js` 覆盖：原生暂停/播放后状态对齐、后台进度补报、同曲目续播不回跳、异曲目按历史进度起播、面板切歌、冷启动恢复、起播窗口、stop 后进度不被清零、定时关闭不回归。
- `mine-module.test.js` 覆盖：起播/节流/seek/回前台事件打点、队列与失败补报、单批 50 条与队列上限、页面正常/错误/空三态、**静态断言真实收听区块已从 WXML 移除且页面不再引用 heatmap**、8 枚徽章亮/暗达成状态与语义化图标规则、**静态断言无主题切换残留**、点击 toast、热力格纯函数保留、清空历史联动、清缓存保留项、**静态断言「我的」页不含继续收听卡片与续播逻辑**、**品牌改名「枕书」全站旧称清零**、**品牌配置与 app.json / 页面 json / brand.wxss / project.config.json 同步且业务代码不硬编码品牌名**、**徽章文案全部来自 `config/brand.js`（含占位符已替换）**。

真机行为仍按第 4 节清单验收。

### 组件按需注入（上传前代码质量扫描）

`app.json` 已配置 `"lazyCodeLoading": "requiredComponents"`——微信开发者工具上传时「代码质量扫描 > 组件：启用组件按需注入」检测的就是这一项。官方要求基础库 2.11.1+（2.11.1 以下兼容但无优化效果），工具调试需 1.05.2111300+ 且基础库选 2.20.1+；本工程 `project.private.config.json` 的 `libVersion` 为 3.18.0。

- **官方限制**：启用后只注入当前访问页面所需的页面代码与自定义组件，未访问页面的 JS 不执行；页面 `usingComponents` 声明的组件和 `app.json` 里的全局自定义组件都会被视为依赖一并注入，因此要及时移除未使用的声明；插件包与扩展库不支持按需注入。
- **本工程核对结果**：`app.json` 无全局 `usingComponents`；index / album / history / mine 四页声明并渲染 `mini-player`，player 页 `usingComponents` 为空；无插件、无 `selectComponent` / `relations` / `behaviors` 等跨组件运行时依赖；服务模块均为纯函数定义，无顶层副作用。
- **与后台播放不冲突**：`app.js onLaunch` 的 `player.init()` 属公共代码，启动时即注入并绑定 BGM 事件；页面与 mini-player 的 `player.subscribe()` 会在注入后立即收到一次当前状态快照，所以页面 JS 延后注入不影响 `reconcile()` 对账。
- 官方明确要求「修改配置后务必确认小程序的表现正常」：开启后需重新编译，并真机走一遍第 4 节清单（尤其第 11~13 项联动场景）。

## 4. 体验版验证清单（iOS + Android 各一台）

| # | 场景 | 期望 |
| --- | --- | --- |
| 1 | 枕书 → 专辑 → 点一集 | 正常播放，锁屏面板显示标题 / 专辑 / 封面 |
| 2 | 锁屏 10 分钟 / 切微信聊天 | 持续播放不断音 |
| 3 | 锁屏面板点上一首 / 下一首 | 切歌正确，回前台状态一致 |
| 4 | 播完一集 | 自动播下一集；最后一集播完停止 |
| 5 | 设 15 分钟定时后锁屏 | 到点停止（先按第 3 节探针确认单位） |
| 6 | 设「播完当前」后锁屏 | 当前集播完即停止，不自动连播 |
| 7 | 后台上传一条音频 | 下拉刷新枕书/专辑后可见 |
| 8 | 后台下架一条音频 | 刷新后不再展示，历史中该条自动隐藏 |
| 9 | 播放中途退出再进「最近播放」 | 有进度记录，点「继续播放」从上次位置续播 |
| 10 | 拖动进度条 | 正常 seek（仅前台有效） |
| 11 | 播放中最小化 → 用微信顶部音频条暂停 → 回小程序 | mini-player 显示「播放」，点它从原位置续播，不回到旧进度 |
| 12 | 播放中最小化 → 微信音频条播放/暂停多次 → 回「最近播放」点当前曲目的「继续播放」 | 音频不跳、不重启，按钮状态与音频条一致，列表进度显示当前实时位置 |
| 13 | 后台播放后杀掉小程序再打开 | mini-player 恢复当前曲目，可继续控制微信音频条 |
| 14 | 播放中切到「我的」tab | tabBar 为 3 项（**枕书 / 最近 / 我的**）；页面自上而下为 成绩单 → 成就徽章 → 专辑完成度 → 工具，**不出现「继续收听 / 最近播放卡片 / 真实收听 / 累计收听 / 连续收听 / 热力格」任一文案或控件**；音频不中断、mini-player 状态与音频条一致 |
| 15 | 「我的」页看徽章墙 | 8 枚恒定显示；已达成的是亮态（彩色渐变章面 + 光点 + 100% 进度 +「已点亮」），未达成的是暗态（灰阶虚线环 + 进度 +「还差 N」）；新用户 8 枚全暗 |
| 16 | 逐枚核对 8 个徽章图标；切换手机系统深色模式 | 「开卷有益」看得出是翻开的书，其余图标语义清晰、小尺寸不糊；页面始终浅色，无「亮色 / 暗色」切换控件，徽章亮暗只随成就状态变化 |
| 17 | 首页看「枕书」品牌徽标，再切「我的」tab | 88rpx 徽标里一弯月 / 一卷书 / 一枕清晰可辨，标题与副标题对齐；「我的」页无「继续收听」卡片，续播只在「最近」tab 可用 |
| 18 | 「我的」页清空播放历史 / 清空本地缓存 | 二次确认写明会重置统计与成就徽章（不含连续天数 / 热力格）；清空后成绩归零、8 枚徽章全部回暗、最近播放为空；清缓存后无需重新登录、定时任务与待报队列仍在 |
| 19 | 点任意徽章（含暗态） | toast 显示达成条件与「已点亮 / 还差 N」；按压有轻微缩放反馈；全程音频不中断 |

## 5. 已知限制

1. **个人主体 + 音频/有声读物类目未开放**，`requiredBackgroundModes` 正式版还需审核 → 本次只保证体验版可用，正式发布大概率被驳回。
2. 后台状态下官方不允许通过 API 操纵播放状态，锁屏面板切歌在个别基础库可能不生效（第 3 项验证），此时降级为「播完自动连播 + 前台可切」。
3. 后台播放期间不会实时回写历史进度（平台限制，见上）。
4. `setShutdown` 的可用性与 `time` 单位需真机确认（第 3 节）。
5. 音频 URL 为 bucket 公有读长期地址（桶必须改「公有读私有写」，否则直链 403；体验域名官方限 10QPS、无加速）；若改短时效签名，长时间后台播放会断。
6. 隐私合规：mp 后台需配置《小程序用户隐私保护指引》，声明收集 openid 与播放记录。
7. **v0.12.1 起「我的」页不再展示真实收听统计**，但 `play_events` 采集链路（表 / 2 接口 / 播放器打点）仍保留：小程序被系统回收且用户不再打开期间无法补记，后台跨曲自动连播也可能漏记，因此这些数据不宣称精确统计；页面不再写误差说明。若确认永久不用，按 CR-01 的 Q-11 单独下线，避免留下看不见的请求与写库开销。
8. `play_events` 从上线后开始记录，上线前的历史收听不回填；清空播放历史会连带清空事件且不可恢复，成绩单与徽章同步归零。
9. `utils/heatmap.js` 已成为未引用文件（页面不再渲染热力格），本次保留其纯函数与测试，登记为待清理项；删除不影响小程序包体积（`tests/` 已被 `packOptions.ignore` 排除）。
