<h1 align="center">宝宝锁</h1>

<p align="center">
  <a href="https://github.com/passwordis42/baobao-lock/releases/tag/v1.0.0"><img alt="platform Windows" src="https://img.shields.io/badge/platform-Windows-0078D6?style=flat-square&logo=windows&logoColor=white" /></a>
  &nbsp;
  <a href="https://www.electronjs.org/"><img alt="Electron" src="https://img.shields.io/badge/Electron-33-47848F?style=flat-square&logo=electron&logoColor=white" /></a>
  &nbsp;
  <a href="https://github.com/passwordis42/baobao-lock/releases/tag/v1.0.0"><img alt="release v1.0.0" src="https://img.shields.io/badge/release-v1.0.0-FF6B95?style=flat-square" /></a>
  &nbsp;
  <a href="#许可与隐私"><img alt="license TBD / unlicensed" src="https://img.shields.io/badge/license-TBD%20%2F%20unlicensed-lightgrey?style=flat-square" /></a>
</p>

<p align="center">开会或直播时锁住键盘，免得小孩乱按。鼠标和触控板照常使用。<br />
<sub>界面简体中文 · 正式第一版 v1.0.0 · 仅 Windows</sub></p>

<p align="center">
  <img src="docs/design/v0/widget-locked.png" width="480" alt="已上锁挂件：右下角的锁宝，徽章「已上锁」，提示按 Ctrl+Alt+L 解锁" />
</p>

<p align="center">
  <a href="#下载">下载</a>
  &nbsp;·&nbsp;
  <a href="#功能">功能</a>
  &nbsp;·&nbsp;
  <a href="#已知问题">已知问题</a>
  &nbsp;·&nbsp;
  <a href="#怎么用">怎么用</a>
  &nbsp;·&nbsp;
  <a href="#界面">界面</a>
  &nbsp;·&nbsp;
  <a href="#怎么实现">怎么实现</a>
  &nbsp;·&nbsp;
  <a href="#构建">构建</a>
  &nbsp;·&nbsp;
  <a href="#许可与隐私">许可与隐私</a>
  &nbsp;·&nbsp;
  <a href="#其他语言">其他语言</a>
</p>

## 下载

<p align="center">
  <a href="https://github.com/passwordis42/baobao-lock/releases/download/v1.0.0/Baobao-Lock-Setup-1.0.0.exe"><img alt="Download v1.0.0 for Windows x64" src="https://img.shields.io/badge/Download%20v1.0.0-Windows%20x64-FF6B95?style=for-the-badge&logo=windows&logoColor=white" /></a>
</p>

**v1.0.0 是正式第一版。** 只提供 **Windows 10 / 11 的 64 位**安装包。没有 32 位，也没有 macOS。

| | |
| --- | --- |
| 安装包 | [**Baobao-Lock-Setup-1.0.0.exe**](https://github.com/passwordis42/baobao-lock/releases/download/v1.0.0/Baobao-Lock-Setup-1.0.0.exe) |
| 本版说明 | [v1.0.0](https://github.com/passwordis42/baobao-lock/releases/tag/v1.0.0) · 2026-10-28 · 正式第一版 |
| 以后的版本 | [Releases](https://github.com/passwordis42/baobao-lock/releases) · `Baobao-Lock-Setup-x.y.z.exe` |

未签名。SmartScreen 可能提示「未知发布者」，这不表示锁已经生效。默认不用管理员，安装到当前用户目录。打开后只有托盘图标，**不会上锁**，也不会写入开机启动项。

## 功能

给开会、直播时旁边可能有小孩拍键盘的人用。独立的 Windows 小工具：自己决定何时锁、何时开。开机不会自己锁上，也不和「专注守卫」联动。

宝宝锁 · 进程 `BaobaoLock.exe` · 角色「锁宝」（圆锁、腮红、简笔五官，原创）· 需求见 [docs/PRD.md](docs/PRD.md)

| 会做 | 不做 |
| --- | --- |
| 拦住键盘，包括 Alt+Tab、Win 键 | 不锁鼠标 / 触控板，不全屏 |
| 默认 `Ctrl+Alt+K` 上锁、`Ctrl+Alt+L` 解锁，设置里可改 | 不写开机启动；打开后停在托盘，不会自动上锁 |
| 长按 `Esc` 满 3 秒紧急解锁 | 不和专注守卫、日历或其他软件联动；没有家长密码 |
| 上锁时右下角可拖小挂件，可跨屏，位置会记住 | 没有 macOS、Linux、手机版 |
| 托盘菜单；可改键、关提示音、挂件置顶 | `Ctrl+Alt+Del` 在系统安全桌面，拦不住 |
| 解锁组合按错时提示「哎呀，还锁着哦」，不抢焦点 | 钩子没真正生效时，不显示已上锁，也不假装已经锁住 |

未上锁时没有桌面挂件。

## 已知问题

状态日期 2026-10-28。最新 Release **[v1.0.0](https://github.com/passwordis42/baobao-lock/releases/tag/v1.0.0)**，正式第一版。

**当前开放：**

无。

**已修复**

| ID | 版本 | 说明 |
| --- | --- | --- |
| `loadApi` 第二次返回 `undefined` | v0.1.0 → **v0.1.1** | 再次安装钩子时 `kernel32` 被弄丢，详情变成 `Cannot read properties of undefined (reading 'func')`。0.1.1 改为缓存已加载的 `user32` / `kernel32` 再返回。 |

<details>
<summary>发版时怎么改这一节</summary>

1. 这一版仍然存在的问题留在「当前开放」，写上版本号和用户能看到的现象。
2. 这一版修好的从开放列表删掉，在已修复表加一行：哪一版出现、哪一版修好、一句话原因。
3. 开放列表空了就写「无」。不要留过期条目。
4. 状态日期和最新 Release 改成这一版。
5. 还没发布的修复不要提前写成已修复。

</details>

## 怎么用

钩子没真正生效时不会进入已上锁。

| 动作 | 默认 |
| --- | --- |
| 打开菜单 | 左键或右键托盘图标。未上锁薄荷绿，已上锁粉色，钩子没生效会写「钩子未生效」 |
| 上锁 | `Ctrl+Alt+K`（设置里可改） |
| 解锁 | `Ctrl+Alt+L`，或长按 `Esc` 满 3 秒（挂件上是黄色进度环） |
| 上锁之后 | 键盘（含 Alt+Tab、Win）被拦住。鼠标可以拖挂件，位置会记住，也能拖到另一块屏幕 |
| 解锁组合按错 | 「哎呀，还锁着哦」，不抢焦点。提示音可以关掉 |
| 系统退路 | `Ctrl+Alt+Del` 拦不住 |

改键时，`Esc` 留给紧急解锁，不能设成快捷键。`Ctrl+Alt+Del` 也不能设成快捷键。

## 界面

按已确认的 [UI v0](docs/design/v0/README.md) 实现（[确认记录](docs/design/v0/APPROVED.md)）。图是 `docs/design/v0/` 里的设计稿。奶油底、浅粉和薄荷绿。没有暗色模式。未上锁时只有托盘，不放桌面挂件。

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/design/v0/widget-locked.png" width="320" alt="已上锁挂件：锁宝与「已上锁」徽章" /><br />
      <b>已上锁</b><br />
      角落可拖 · 徽章「已上锁」
    </td>
    <td align="center" width="50%">
      <img src="docs/design/v0/widget-unlocking.png" width="320" alt="长按 Esc 时的黄色进度环" /><br />
      <b>紧急解锁</b><br />
      长按 Esc · 圆环进度，不是底栏
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="docs/design/v0/settings.png" width="320" alt="设置窗：改键、提示音、挂件置顶" /><br />
      <b>设置</b><br />
      改上锁 / 解锁键、提示音、挂件置顶
    </td>
    <td align="center" width="50%">
      <img src="docs/design/v0/tray-menu.png" width="320" alt="托盘菜单，旁注锁态与开态图标" /><br />
      <b>托盘</b><br />
      薄荷绿未上锁 / 粉色已上锁
    </td>
  </tr>
  <tr>
    <td align="center" colspan="2">
      <img src="docs/design/v0/tip-wrong-key.png" width="320" alt="按错解锁时的提示：哎呀，还锁着哦" /><br />
      <b>按错提示</b><br />
      「哎呀，还锁着哦」· 不抢焦点
    </td>
  </tr>
</table>

托盘菜单里有上锁或解锁、打开设置、退出。色板和各屏说明见 [docs/design/v0/README.md](docs/design/v0/README.md)。图标：`src/assets/icon-locked.svg`、`src/assets/icon-unlocked.svg`。

## 怎么实现

界面是 Electron。键盘钩子是 `SetWindowsHookExW(WH_KEYBOARD_LL)`，装在独立原生线程上，由那条线程自己 `GetMessage` / `DispatchMessage`。不挂鼠标钩子。koffi 只在这个原生模块没载入时作后备。

钩子必须在这一下按键送出之前决定吞不吞。低级钩子只在安装它的线程正在泵消息时才会被调用。安装时由另一条线程 `SendInput` 一个打不出字的探测键（VK `0xE8`），在原生回调里认。认不到就留着钩子，等第一次真实按键；这一下被拦住才进入已上锁。真实按键也进不了回调，才弹出「键盘钩子未生效 / 键盘现在没有锁住」。

清单是 `asInvoker`：默认不用管理员，安装到当前用户目录。失败时可以再试一次「以管理员身份运行」，但失败不会画成已上锁。和专注守卫没有联动，也不读它的状态。

打包和钩子细节：[docs/BUILD.md](docs/BUILD.md) · 产品边界：[docs/PRD.md](docs/PRD.md)

## 构建

64 位 Windows，Node.js 20 或更新：

```bash
npm ci
npm test
npm run dist
```

产物是 `release/Baobao-Lock-Setup-<version>.exe`。`npm test` 不挂键盘钩子，macOS / Linux 上也能跑。签名、SmartScreen、koffi 打进安装包的注意点在 [docs/BUILD.md](docs/BUILD.md)。

CI（`.github/workflows/windows-setup.yml`）会跑测试并上传安装包构建产物，不会自动创建 GitHub Release。对外下载以 [Releases](https://github.com/passwordis42/baobao-lock/releases) 为准。

## 许可与隐私

仓库根目录目前没有 `LICENSE` 文件。在补上许可证之前，不要把它当成可以自由复制或再发布的开源授权。

程序不联网，也不上传按键。快捷键、提示音开关和挂件位置写在本机的 `settings.json`（Electron `userData`）。同目录的 `baobao.log` 只记钩子安装成败和错误摘要，不记你按下的普通键。

## 其他语言

<details>
<summary>English</summary>

Baobao Lock (宝宝锁) is a small Windows tool for meetings and live streams. It locks the keyboard so a child bumping the keys does not type into your call or stream. The mouse and trackpad keep working. You lock and unlock it yourself. It does not lock on startup, and it is not connected to Focus Guard. The app UI is Simplified Chinese.

| | |
| --- | --- |
| Name | 宝宝锁. Process `BaobaoLock.exe`. Character 锁宝 (original). |
| Lock | Swallows keys, including Alt+Tab and the Windows key. Default `Ctrl+Alt+K`. |
| Unlock | `Ctrl+Alt+L`, or hold `Esc` for 3 seconds. |
| Widget | A small draggable corner character while locked. None when unlocked. |
| Out of scope | No mouse/trackpad lock, no fullscreen cover, no parental password, no macOS or phone build, no login item, no `Ctrl+Alt+Del` block. |
| Honest failure | If the hook is not actually swallowing keys, the app says so and does not show a locked state. |

Current release: **v1.0.0**, the formal first release. No open issues.

Download (Windows 10/11 x64, unsigned): [Baobao-Lock-Setup-1.0.0.exe](https://github.com/passwordis42/baobao-lock/releases/download/v1.0.0/Baobao-Lock-Setup-1.0.0.exe) · [v1.0.0 notes](https://github.com/passwordis42/baobao-lock/releases/tag/v1.0.0) · [all releases](https://github.com/passwordis42/baobao-lock/releases). SmartScreen may warn about an unknown publisher. Per-user install; opens to the tray and does not lock on launch.

Tray: mint when unlocked, pink when locked. Wrong unlock chord shows 「哎呀，还锁着哦」 without stealing focus.

Electron UI. A native thread installs `SetWindowsHookExW(WH_KEYBOARD_LL)` and runs `GetMessage`. Another thread injects a non-typing probe with `SendInput`. Manifest is `asInvoker`. Not linked to Focus Guard. Depth: [docs/BUILD.md](docs/BUILD.md), [docs/PRD.md](docs/PRD.md).

</details>

<details>
<summary>繁體中文</summary>

開會或直播時只鎖鍵盤，避免小孩亂按；滑鼠與觸控板仍可用。畫面文字是簡體中文。目前發布是 **v1.0.0**，正式第一版。

</details>

<details>
<summary>日本語</summary>

会議や配信のあいだ、キーボードだけをロックして、子どもの誤操作を防ぎます。マウスとトラックパッドはそのまま使えます。画面の文言は簡体字中国語です。現在のリリースは **v1.0.0** で、正式な第一版です。

</details>
