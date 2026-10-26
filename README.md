# 同空时刻

一个用于统计多人共同空闲时间的微信小程序。

店主排班、小组开会、朋友约时间时，不需要在群里逐个询问「你几点有空」。创建人选定日期后把房号发到群里，成员各自勾选自己的空闲时段，系统会算出所有人都能到场的共同时间，并列出具体有空的成员。

## 功能

- 6 位数字房号创建、加入，支持微信群分享
- 从今天起 14 天内任选日期，不要求连续
- 15 分钟为一格，按时间网格勾选空闲
- 点日期选整天、点时间选同一时段、一键全选或清空
- 超过 7 天自动按周分页，避免手机端列宽过窄
- 自动保存填写进度，离开页面时补存
- 结果按日期分组，展示共同空闲起止时间、时长及全程有空的人员名单
- 支持「全员 / N 人及以上」人数阈值筛选
- 创建者可改名、删除房间；首页支持两级左滑删除
- 深色模式跟随系统，也可手动切换并记住选择
- 空余位图使用十六进制编码，减少存储和传输体积

## 技术栈

- 微信小程序原生框架：WXML / WXSS / JavaScript
- WorkBuddy Cloud SDK：微信登录、托管 PostgreSQL 数据库
- PostgreSQL 行级安全（RLS）隔离房间写入权限
- Node.js 测试脚本，覆盖日期、位图、权限、手势和页面逻辑

## 快速开始

### 环境要求

- 微信开发者工具
- Node.js 18 或更高版本（仅安装依赖和运行测试时需要）

### 导入项目

1. 用微信开发者工具导入本目录。
2. 本地体验可使用 `project.config.json` 中的测试 AppID；正式运行前请换成自己的小程序 AppID。
3. 项目已包含 `miniprogram_npm`，导入后可直接预览页面。

如需重新安装依赖：

```bash
npm install
```

然后在微信开发者工具中执行「工具 -> 构建 npm」。

### 云服务配置

`config.js` 中保存的是 WorkBuddy Cloud 的公开配置：

```js
const publicConfig = {
  endpoint: 'https://mp-api.app.workbuddy.host',
  publishableKey: 'wbpk_...',
}
```

其中 `publishableKey` 仅用于标识应用，不携带写权限。不要在项目中加入服务端密钥、GitHub Token 或其他私密凭据。

首次在其他环境部署时，需要准备 `rooms` 和 `members` 两张表，并配置相应 RLS 策略。房间删除依赖 `members.room_id` 外键的 `ON DELETE CASCADE`。

## 使用流程

1. 首页点「创建一个时间局」，填写昵称和局名。
2. 从未来 14 天中选择需要统计的日期。
3. 进入房间后，把 6 位房号或分享卡片发到微信群。
4. 每位成员进入房间并勾选自己的空闲时间。
5. 至少两人填写后，打开「看共同空闲」查看结果。
6. 根据完整人员名单选择开会或排班时间。

## 数据结构

日期集合保存在 `rooms.selected_dates`，格式为升序 JSON 日期数组：

```json
["2026-10-26", "2026-10-28", "2026-11-02"]
```

每天固定 96 格，每格 15 分钟。位图索引为：

```text
index = dayIndex * 96 + slotIndex
```

位图按十六进制存储，1 天为 24 个字符，14 天为 336 个字符。

## 项目结构

```text
.
├── app.js / app.json / app.wxss
├── config.js                 # 云服务公开配置与构建版本
├── theme.json                # 系统深色模式配置
├── pages/
│   ├── index/                # 首页：创建、加入、我的房间
│   ├── room/                 # 房间：房号、分享、成员进度
│   ├── select/               # 勾选：15 分钟时间网格
│   └── result/               # 结果：共同空闲与人员名单
├── utils/
│   ├── api.js                # 房间与成员数据访问
│   ├── auth.js               # 静默登录
│   ├── slots.js              # 空余位图编解码
│   ├── theme.js              # 深色模式
│   ├── time.js               # 日期与时间区间
│   └── ui.js                 # wx 接口安全封装
└── tests/                    # Node 回归测试
```

## 运行测试

```bash
node tests/check.js
node tests/smoke.js
node tests/timeout.js
node tests/preview.js
node tests/result-logic.js
node tests/select-page.js
node tests/swipe-delete.js
node tests/theme.js
node tests/list-owner.js
```

全部测试通过时，每个脚本会输出对应的检查结果。

## 说明

- 微信登录必须在小程序运行环境中完成，普通网页预览无法取得真实登录凭证。
- 修改代码后需要重新发布小程序，微信可能会缓存旧代码包。
- 首页底部会显示构建版本，可用于确认当前运行的是否为最新版本。

## 版本

当前版本：**v1.14**

仓库地址：https://github.com/JinhuiChan/tongkong-shike
