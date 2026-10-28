# 构建 Windows 安装包

宝宝锁 v0.1.0 用 Electron 做界面（直接沿用 `docs/design/v0/` 的挂件、设置、托盘菜单和 toast），主进程通过 [koffi](https://koffi.dev/) 调用 `SetWindowsHookExW(WH_KEYBOARD_LL)` 拦截键盘。不锁鼠标。安装包是 NSIS，文件名 `Baobao-Lock-Setup-0.1.0.exe`。

只支持 64 位 Windows 10 / 11。默认 **不以管理员身份** 运行（清单 `asInvoker`，安装到当前用户目录）。

## 本机打 Setup

需要 Node.js 20 或更新版本。

```bash
npm ci
npm test
npm run dist
```

产物：

```text
release/Baobao-Lock-Setup-0.1.0.exe
```

安装后的程序名是 `BaobaoLock.exe`，开始菜单和桌面快捷方式显示「宝宝锁」。安装结束可选择立刻打开；打开后停在托盘，**不会上锁**。不会写入开机启动项。

开发时在 Windows 上：

```bash
npm start
```

`npm test` 不挂键盘钩子，在 macOS / Linux 上也能跑。`npm run smoke` 会启动 Electron，并确认钩子没装上时 `locked` 仍为 false。

## 图标

托盘和安装包图标来自 `src/assets/icon-locked.svg` / `icon-unlocked.svg`（与设计稿相同）。需要重做 PNG / ICO 时：

```bash
npm run icons
```

## 签名

这个版本不带证书。`electron-builder` 在没有 `CSC_LINK` 时打出来的是未签名安装包，SmartScreen 可能提示未知发布者。

要签名时，在打包装前设置：

- `CSC_LINK`：证书文件（`.pfx`）路径或 base64
- `CSC_KEY_PASSWORD`：证书密码

然后照常 `npm run dist`。不要为了签名把 `requestedExecutionLevel` 改成 `requireAdministrator`。

## 钩子没装上

程序会弹出「键盘钩子未生效 / 键盘现在没有锁住」，托盘状态是「钩子未生效」，**不会**出现已上锁挂件。可以右键 `BaobaoLock.exe`，选「以管理员身份运行」再试一次。平时不需要管理员。

钩子回调必须在按键交给其他程序之前同步返回。安装时会用一个不会打到文本里的探测键（F23）确认这一点；探测失败同样视为没锁上。

## CI

`.github/workflows/windows-setup.yml` 在 Windows 上跑测试并上传 `Baobao-Lock-Setup-*.exe` 为构建产物。不要在这个流程里打 GitHub Release。
