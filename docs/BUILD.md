# 构建 Windows 安装包

宝宝锁 v0.1.3 用 Electron 做界面（直接沿用 `docs/design/v0/` 的挂件、设置、托盘菜单和 toast），键盘钩子在独立原生线程里调用 `SetWindowsHookExW(WH_KEYBOARD_LL)` 并自己跑 `GetMessage`。不锁鼠标。安装包是 NSIS，文件名 `Baobao-Lock-Setup-0.1.3.exe`。

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
release/Baobao-Lock-Setup-0.1.3.exe
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

钩子回调必须在按键交给其他程序之前同步返回。安装时会从另一条线程 `SendInput` 一个不会打出字符的探测键（VK `0xE8`）。探测键如果没进回调，钩子先留着，等第一次真实按键；确认前不会显示已上锁。真实按键也进不了回调，才卸掉并说明键盘没有锁住。

低级键盘钩子只在安装它的那条线程正在 `GetMessage` / `PeekMessage` 时才会被调用。0.1.1 在同一条线程里同步调用 `keybd_event`，函数一返回就读标志。0.1.2 改成 koffi 异步注入，再在主线程里同步 `PeekMessage` / `MsgWaitForMultipleObjects`；医生的 Windows 10 上回调仍然进不了 JS，自检还是 `probe-not-sync`，钩子被卸掉。0.1.3 把钩子装在独立线程的 `GetMessage` 循环上，探测在原生代码里认。koffi 只作为这个原生模块没载入时的后备。以管理员再运行一次不是这条的修法。状态以仓库首页 [已知问题](../README.md#已知问题) 为准。

`npm run dist` 会先 `node-gyp rebuild --directory native`，编出 N-API 模块 `native/build/Release/hook_thread.node`。它不需要按 Electron 头文件重编。Windows 上需要 Visual Studio 的 C++ 生成工具（GitHub `windows-latest` 自带）。

对话框里的「详情」分两种：`SetWindowsHookExW 失败（系统错误码 …）` 是 Windows 的返回值；`程序内部错误，不是权限不足：…` 是脚本异常。0.1.0 里第二次安装钩子会把 `kernel32` 弄丢，详情变成 `Cannot read properties of undefined (reading 'func')`。那是内部错误，键盘并没有锁上。0.1.1 会把已加载的 `user32` / `kernel32` 缓存下来再返回。

## koffi 与安装包

`koffi` 写在 `dependencies` 里。electron-builder 会按生产依赖把它打进包，同时用 `files` 排除手写的 `node_modules` 扫描，再单独拷贝依赖，所以不要把 `koffi` 改成 devDependency。

`asarUnpack` 必须盖住 `node_modules/koffi/**/*`，让 `build/koffi/win32_x64/koffi.node` 落在 `app.asar.unpacked`。原生模块不能留在 asar 里。

`npmRebuild` 保持 `false`。koffi 自带 N-API 预编译包，用 Electron 头文件重编既不需要，也容易把预编译包编坏。

## CI

`.github/workflows/windows-setup.yml` 在 Windows 上跑测试并上传 `Baobao-Lock-Setup-*.exe` 为构建产物。不要在这个流程里打 GitHub Release。
