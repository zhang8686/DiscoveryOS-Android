# DiscoveryOS · Android 平板客户端

一个为 **Android 平板**设计的 4d4y（Discovery）论坛原生客户端。全中文界面，三栏布局以正文阅读为中心：在不牺牲功能的前提下，尽量把屏幕留给内容。

> 本项目为**非官方**客户端，与 4d4y.com、Comsenz / Discuz! 无关联，也未获得其认可或赞助。论坛内容与账号数据归论坛及其用户所有，使用请遵守论坛规则。

> **最新版本 v1.0.33**（2026-11-19）：手机端适配、板块栏折叠与计数刷新、抖音与 B 站视频内嵌播放、图片查看器重做等。详见 [更新说明](docs/更新说明-v1.0.33.md)；APK 见根目录 `DiscoveryOS-AndroidPad-V1.0.33.apk`。

---

## 界面预览

截图为 1280 × 800 平板横屏下的实际运行画面。

### 默认三栏视图

![默认三栏视图](screenshots/overview.png)

左侧版块与常用入口，中间帖子列表，右侧正文与回复；三个标题栏图标（收藏、浏览器打开、复制链接）等距排列，每个楼层右上角有引用按钮，底部常驻回帖输入框与「图片 / 附件」。

### 筛选控件展开

![筛选控件展开](screenshots/filters.png)

排序控件默认收起，点开显示「发帖时间 / 回帖时间」；长按任意帖子可「隐藏该贴」。已读帖子灰字显示，未读深色加粗。

### 版块折叠

![版块折叠](screenshots/channels-folded.png)

默认只显示排序前 4 个版块，其余收在下方小图标堆里；点「展开全部 19 个」一次展开，「收起」回到 4 个，选择会被记住。

### 拖动排版

![拖动排版](screenshots/channel-reorder.png)

长按版块或点「排序」进入排版，按住上下拖动即可调整顺序；顺序会被记住。

---

## 设计思路

为平板而做，核心只有一句：**把屏幕留给正文**。

- **正文优先的三栏**：版块栏 168dp、帖子列表 288dp、正文占其余，1200dp 横屏下正文约占 62% 屏宽；版块与帖子行 36dp、图标按钮 32dp，一屏容纳更多。
- **顺手**：常用入口固定在侧栏不随滚动消失；系统返回键按层级退出；下拉刷新、正文右滑返回；无 hover / 快捷键依赖。
- **好读**：已读置灰、未读加粗；正文图片点击放大并可保存；引用块可跳转楼层；B 站 / 抖音 / 小红书及常见视频链接内嵌播放。
- **够轻、够安全**：只申请 `INTERNET` 一项权限；不存明文密码、仅保持会话 Cookie；数据全部在应用私有存储中。

功能面同样齐全：19 个真实版块、长按拖动排序、发帖 / 回帖两种排序、回帖与发帖可加图片附件、收藏 / 我的主题 / 我的回复 / 私信 / 历史常驻侧栏。

---

## 体积与资源占用

| 项目 | 数值 |
| --- | --- |
| 当前版本 | 1.0.26（versionCode 28） |
| APK 体积 | 约 18.9 MB（单 arm64-v8a） |
| 应用自身逻辑包 | 约 245 KB（`assets/nsh/bundle.nshc`） |
| 应用图标 | 约 13 KB |
| 主要体积来源 | NSH 预编译运行时 `lib/arm64-v8a/libnsh.so`（原始 46.6 MB，压缩存储后约 19 MB） |
| 安装后设备占用 | 约 66 MB（系统在安装时解压原生库；下载包小、设备多占一份） |
| 运行权限 | 仅 `android.permission.INTERNET` |
| 系统要求 | minSdk 26 / targetSdk 35，面向 Android 10 及以上平板 |
| 本地数据 | 浏览历史上限 200 条；版块顺序、排序与筛选、会话 Cookie 存于应用私有存储 |
| 账户信息 | 不落盘明文密码，仅保持 Cookie |

> 应用自身代码与资源不到 300 KB，体积几乎全部来自框架运行时。原生库以压缩方式存储、安装时由系统解压，因此下载体积明显减小，但设备占用相应增加，运行内存不变。

---

## 安装

1. 从 [Releases](https://github.com/zhang8686/DiscoveryOS-Tablet/releases) 下载最新版 `DiscoveryOS-AndroidPad-V1.0.26.apk`。
2. 在 Android 平板上打开该文件；首次安装时系统可能要求为安装来源开启「允许安装未知应用」，授权一次即可。
3. 仅支持 **arm64-v8a** 设备，32 位平板不在支持范围。
4. 论坛内容需要登录后查看，请在应用内登录 4d4y 账号。

升级时请使用同一签名密钥发布的版本，否则无法覆盖安装。

---

## 源码与构建

本仓库为纯 TSX 工程，使用 NSH 打包；发布包额外做一次原生库压缩以减小下载体积：

```bash
nsh package App.tsx --target android --icon icon.png --abi arm64-v8a \
  --keystore <release.jks> --key-alias <alias>
python scripts/slim_apk.py .nsh/out/DiscoveryOS.apk unsigned.apk --zopfli
zipalign -f -p 4 unsigned.apk aligned.apk
apksigner sign --ks <release.jks> --ks-key-alias <alias> \
  --out DiscoveryOS-AndroidPad-V1.0.26.apk aligned.apk
```

`scripts/slim_apk.py` 把清单中的 `android:extractNativeLibs` 设为 `true`，把 `lib/<abi>/*.so` 改为压缩存储；加 `--zopfli` 时再用最优 DEFLATE 重压该原生库（约省 0.55 MB）。其余条目逐字节保留，应用代码与资源不受影响。重打包后必须用同一 release keystore 重新签名。

构建环境：NSH 0.5.1、JDK 17、Android SDK 35 / build-tools 35.0.1。发布包使用自己的 release keystore 签名（密钥不随仓库分发）。

主要目录：

| 路径 | 内容 |
| --- | --- |
| `App.tsx` | 应用入口、登录与整体状态 |
| `src/discuz/` | 论坛请求、GB18030 编解码、页面解析、Cookie 与收藏 |
| `src/ui/` | 三栏界面、简笔画图标、帖子行、回复框、播放器组件 |
| `src/bilibili`、`src/douyin` 等 | 外链媒体的解析与播放 |
| `screenshots/` | 本文所用界面截图 |
| `scripts/slim_apk.py` | 发布包原生库压缩与重打包 |

---

## 源码来源与致谢

- **[nicoster/DiscoveryOS-nsh](https://github.com/nicoster/DiscoveryOS-nsh)** — 上游项目，由 **Nick Xiao** 开发的 4d4y 论坛桌面客户端（MIT 许可）。本应用在其论坛数据层与界面结构之上构建，谨致谢意。
- **[NSH / Native Shell](https://nsh.dev)**（[longbridge/nsh](https://github.com/longbridge/nsh)，Apache-2.0）— 让同一套 TSX 代码运行于桌面与 Android 的原生 UI 框架。
- **4d4y.com（Discovery 论坛）** 与社区用户 — 论坛内容与讨论的提供者。
- **Simple Icons（CC0）** — 原仓部分 SVG 图标来源；本应用版块与功能项的线稿图标为项目自绘。

感谢上游作者与维护者开放源码，也感谢论坛社区长期积累的内容。

---

## 许可与免责

本仓库沿用上游的 **MIT License**，版权声明见 [LICENSE](LICENSE)。

本软件按「现状」提供，不附带任何明示或默示担保；作者不对使用本软件产生的任何主张、损害或责任负责。本项目为非官方客户端，与 4d4y.com、Comsenz / Discuz! 无任何隶属、认可或赞助关系。
