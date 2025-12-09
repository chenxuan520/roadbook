# 厌倦了地图API的各种限制？我做了个开源路书工具，离线也能玩！

嗨，大家好，我是 **chenxuan520**。作为一个热爱旅游的开发者，我一直在寻找一款称手的路书规划工具，但市面上的产品总有些不尽如人意的地方：要么需要繁琐的API Key申请，要么在网络不佳时无法使用，要么就是担心自己的行程数据隐私。

于是，我决定自己动手，`RoadbookMaker` 由此诞生。它是一个**完全免费、无需注册、无需任何API Key、甚至可以完全离线使用的路书规划工具**。最重要的是，它完全开源。

**项目与在线体验地址：**

*   **GitHub地址**: <https://github.com/chenxuan520/roadbook>
*   **在线体验**: <https://map.chenxuanweb.top>

<p align="center">
  <img src="https://p0-xtjj-private.juejin.cn/tos-cn-i-73owjymdk6/ea246ef1950d4a2b8e187f478099787d~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAgY2hlbnh1YW41MjA=:q75.awebp?policy=eyJ2bSI6MywidWlkIjoiNjAyOTcyOTE4OTA3NzIwIn0%3D&rk3s=e9ecf3d6&x-orig-authkey=f32326d3454f2ac7e96d3d06cdbb035152127018&x-orig-expires=1765356421&x-orig-sign=vqvzKlYsH1AY3C6KYP%2BLEIzjumg%3D" alt="RoadbookMaker Logo" width="250" height="250">
</p>

***

## 核心优势：简单，但强大

在深入了解如何使用前，先快速概览一下 `RoadbookMaker` 最核心的几个优势：

*   **🚀 真正的零门槛**
    *   **无需API Key**: 无需注册任何地图厂商的开发者账号，免去申请和配置Key的烦恼。
    *   **无需注册登录**: 没有账户体系，打开即用。
    *   **完全离线可用**: 核心功能在断网时依旧可用，所有数据默认安全地存储在你的浏览器本地。

*   **📱 极致的用户体验**
    *   **手机端完美适配**: 响应式设计，在手机上也能获得流畅的规划体验。
    *   **一键集成**：无缝跳转至**导航**（百度、高德、Google）、**携程订票**、**Google酒店**和**小红书**攻略，实现从规划到出行的一站式服务。
    *   **快捷键支持**: 提供 `A` 添加、`C` 连接、`D` 删除等全键盘快捷键，大幅提升规划效率。

*   **🏠 便捷的自托管**
    *   **Docker一键部署**: 提供 Docker 镜像，一条命令就能在自己的服务器或NAS上拥有它。
    *   **数据私有**：自托管意味着数据完全由你掌控，隐私安全感拉满。

## 手把手教你用 RoadbookMaker 规划一次旅行

下面，我们通过一个实例，看看用它规划一次“周末城市漫步”有多简单。

### 第一步：添加你的足迹

打开网站，界面就是一张简洁的地图。你可以通过顶部的搜索框寻找地点，或者直接在地图上进行操作。

![image.png](https://p0-xtjj-private.juejin.cn/tos-cn-i-73owjymdk6/79f43ec79f174d55a45f56eca594d317~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAgY2hlbnh1YW41MjA=:q75.awebp?policy=eyJ2bSI6MywidWlkIjoiNjAyOTcyOTE4OTA3NzIwIn0%3D&rk3s=e9ecf3d6&x-orig-authkey=f32326d3454f2ac7e96d3d06cdbb035152127018&x-orig-expires=1765356743&x-orig-sign=XI%2BhMlXbo3s5yfTZWi6G1%2F4ibfk%3D)

*   **添加标记点**：点击顶部的 “添加标记点” 按钮，或直接按快捷键 `A`，鼠标会变成一个十字准星。在地图上你感兴趣的位置点击一下，一个标记点就添加好了。


![image.png](https://p0-xtjj-private.juejin.cn/tos-cn-i-73owjymdk6/360b6f41ecf747d39908a8caf534c765~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAgY2hlbnh1YW41MjA=:q75.awebp?policy=eyJ2bSI6MywidWlkIjoiNjAyOTcyOTE4OTA3NzIwIn0%3D&rk3s=e9ecf3d6&x-orig-authkey=f32326d3454f2ac7e96d3d06cdbb035152127018&x-orig-expires=1765356781&x-orig-sign=ILHaIy9cVN0Dq9Jl5Lt%2FipwC2n0%3D)
### 第二步：连接成线，规划路线

当你在地图上标记了几个点后（比如咖啡馆、书店、公园），就可以将它们连接起来形成路线。

*   **连接标记点**：点击“连接标记点”按钮或按 `c`，在弹出的窗口中选择起始点和目标点，并选择一种交通方式，例如“步行”🚶。一条代表路线的连接线就生成了。


![image.png](https://p0-xtjj-private.juejin.cn/tos-cn-i-73owjymdk6/5cd176611099498e885a40e55c162892~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAgY2hlbnh1YW41MjA=:q75.awebp?policy=eyJ2bSI6MywidWlkIjoiNjAyOTcyOTE4OTA3NzIwIn0%3D&rk3s=e9ecf3d6&x-orig-authkey=f32326d3454f2ac7e96d3d06cdbb035152127018&x-orig-expires=1765357004&x-orig-sign=OWgwyiTfV1%2FEMcm1lpMYjr9P7YY%3D)


![image.png](https://p0-xtjj-private.juejin.cn/tos-cn-i-73owjymdk6/a0f23b51b7864a87b89c5162e1fccf74~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAgY2hlbnh1YW41MjA=:q75.awebp?policy=eyJ2bSI6MywidWlkIjoiNjAyOTcyOTE4OTA3NzIwIn0%3D&rk3s=e9ecf3d6&x-orig-authkey=f32326d3454f2ac7e96d3d06cdbb035152127018&x-orig-expires=1765357057&x-orig-sign=Cm0QpuvVNc8Kkm%2FXYN%2Bq8JJAEWM%3D)

### 第三步：丰富你的行程细节

现在，路书已经有了基本的框架，我们可以为它填充更多细节。

*   **编辑标记点**：单击任意一个标记点，右侧会滑出详情面板。在这里，你可以：
    *   修改名称，设置到达和离开的**时间**。
    *   为它更换一个醒目的**图标**（支持数字、Emoji或自定义文字）。
    *   通过 “**去小红书搜一搜**” 链接，直接探索这个地点的周边玩法。
    *   通过 “**Google酒店搜索**” 快速查找附近的住宿。

*   **编辑连接线**：同样，单击连接线，也可以在详情面板中：
    *   设置这段路程的**耗时**。
    *   一键跳转到**百度/高德/Google地图**进行导航。
    *   如果交通方式是“火车”🚄或“飞机”✈️，还会出现**携程订票**的快捷链接。


![image.png](https://p0-xtjj-private.juejin.cn/tos-cn-i-73owjymdk6/b6a3527527714fd583e9e031d419818e~tplv-73owjymdk6-jj-mark-v1:0:0:0:0:5o6Y6YeR5oqA5pyv56S-5Yy6IEAgY2hlbnh1YW41MjA=:q75.awebp?policy=eyJ2bSI6MywidWlkIjoiNjAyOTcyOTE4OTA3NzIwIn0%3D&rk3s=e9ecf3d6&x-orig-authkey=f32326d3454f2ac7e96d3d06cdbb035152127018&x-orig-expires=1765357223&x-orig-sign=6Bw%2B5KpvlScMGybOTO5PMp6GCyg%3D)

### 第四步：分享与备份你的路书

规划完成后，你可以轻松地将成果分享给朋友或进行备份。

*   **导出HTML**：这是 `RoadbookMaker` 的一个特色功能。它能生成一个独立的HTML文件，这个文件**内置了所有地图数据和交互功能**。你可以把这个文件发给任何人，对方在任何设备上用浏览器打开，就能看到和你一模一样的路书，无需安装任何东西，当然导出的html路书也可重新导入。
*   **导出JSON**：如果你想在其他设备上继续编辑，可以导出为JSON文件，之后再通过“导入路书”功能恢复。

## 背后的技术思考

为了实现上述流畅且零门槛的体验，我在技术上做了一些选型和实现。

*   **前端 (Vanilla JS + Leaflet.js)**: 前端选择了原生JavaScript，配合强大的开源地图库 `Leaflet.js`。这样做的好处是极致的轻量化，无需任何构建步骤，保证了快速加载和响应，也为完全离线使用打下了基础。

*   **后端 (Go + Gin)**: 后端采用Go语言开发，主要为了实现高性能的API服务和极简的部署。Go可以将整个应用编译成一个无依赖的二进制文件，这使得Docker镜像可以做到非常小。

*   **“无需API Key”的秘密**: 后端的一个核心功能是作为**API代理**。它将前端发来的搜索请求，代为请求百度、天地图等服务，并处理好坐标系转换（例如国内的GCJ-02火星坐标系），最后将干净、统一的数据返回给前端。这样就巧妙地绕开了前端直接调用地图API会遇到的Key暴露和跨域问题。

## 写在最后

`RoadbookMaker` 是我利用业余时间，从解决自身痛点出发，逐步打磨而成的项目。它不追求大而全，而是专注于将“路线规划”这一核心体验做到简单、纯粹、不受限制。

如果你觉得这个项目对你有帮助，或者你也认同它的理念，请在 GitHub 上给我一个 **Star** ⭐！你的支持是我持续更新的最大动力！

再次附上地址，欢迎大家体验和贡献！

*   **GitHub**: <https://github.com/chenxuan520/roadbook>

