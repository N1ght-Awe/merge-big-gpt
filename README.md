# 合成大GPT

把小小的灵感，合成伟大的 GPT 龙娘。基于 **Vite + TypeScript + Matter.js** 的物理合成网页小游戏。无需账号、后端或数据库；角色与音效均不依赖外部服务。

- 在线试玩：<https://n1ght-awe.github.io/merge-big-gpt/>
- 源码仓库：<https://github.com/N1ght-Awe/merge-big-gpt>

## 启动

在本目录打开终端，使用 Node.js 22.12+（或 20.19+）：

```powershell
npm install
npm run dev
```

打开终端显示的地址，默认 <http://127.0.0.1:5173/>。

```powershell
npm run build     # TypeScript 检查 + 生产构建，输出到 dist/
npm run preview   # 本地预览生产构建
npm test          # 真实 Matter.js 物理与状态回归测试
```

手机与电脑连接同一局域网时，可显式运行 `npm run dev -- --host 0.0.0.0`，然后在手机访问电脑的局域网 IP 和端口。防火墙需允许该本地服务。游戏布局支持触摸操作；无须开放公网。

`dist/` 可部署到静态网站服务器（包含子目录部署）；请通过 HTTP 打开，不要直接双击 `dist/index.html`。

## 玩

- 鼠标左右移动选择落点，单击投放；手机按住拖动瞄准，松手投放。
- 选中画布后，`←` / `→` 或 `A` / `D` 调整位置，`空格` / `↓` 投放，`P` 暂停或继续。
- 两个同级角色碰撞会合为下一级；第 11 级保持在场上，不再合并。
- 当前待投放角色显示在画布顶部；左侧预览是**再下一只**。
- 1.8 秒内连续合并触发 Combo；每多一档增加 20% 基础分，奖励按最高 Combo ×8 计算（最多 2.4 倍基础分），提示可以继续增加。
- 角色持续超出警戒线 2.4 秒后游戏结束，显示「上下文溢出了！」。新落下的角色有 1.6 秒入场宽限。
- 首次合成最高级角色时出现庆祝光芒与特别旋律，之后仍可以继续挑战分数。
- 暂停、帮助和图鉴期间物理时间停止；切到后台或离开浏览器焦点也自动暂停，回来后手动继续。
- 最高分和静音偏好保存在当前浏览器的 `localStorage`；不会保存半途棋盘，也不会跨设备同步。


技术参考：[Matter.js Engine](https://brm.io/matter-js/docs/classes/Engine.html)、[Vite](https://vite.dev/guide/)。


