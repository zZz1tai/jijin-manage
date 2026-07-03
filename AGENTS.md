# Expo App + Express.js

## 目录结构规范（严格遵循）

当前仓库是一个 monorepo（基于 pnpm 的 workspace）

- Expo 代码在 `client` 目录，Express.js 代码在 `server` 目录
- 当前项目已经启用底部 Tab Bar，不要再按“无 Tab Bar 模板”处理
- 2026-07-01 已使用 `codegraph index --force .` 完成全仓扫描：`codegraph status` 显示 451 个项目文件、4,260 个节点、7,551 条边，语言包括 `javascript`、`tsx`、`typescript`、`yaml`

### CodeGraph 扫描后的实际结构

```text
client/
├── app/                       # Expo Router 路由层，只放路由、布局和极薄 re-export
│   ├── _layout.tsx            # 根布局：必须保留 Provider、global.css、Toast、Stack 配置
│   ├── (tabs)/                # 底部 Tab：index、holdings、market、dca、profile
│   ├── add-holding.tsx        # modal 路由，导出 screens/add-holding
│   ├── add-transaction.tsx    # modal 路由，导出 screens/add-transaction
│   ├── add-dca.tsx            # modal 路由，导出 screens/add-dca
│   ├── instrument-detail.tsx  # 详情路由，导出 screens/instrument-detail
│   ├── dca-detail.tsx         # 详情路由，导出 screens/dca-detail
│   └── search-quote.tsx       # 搜索路由，导出 screens/search-quote
├── screens/                   # 页面实现层；路由文件应优先 re-export 这里的页面
├── components/                # 跨页面通用组件，Screen.tsx 是页面容器
├── contexts/                  # App/Auth Context；AppContext 负责 DB 初始化、设置、刷新触发
├── db/                        # expo-sqlite 数据层与业务查询
├── heroui/                    # 项目内 UI 组件库、primitives、providers、helpers
├── hooks/                     # 自定义 Hook，例如 useSafeRouter
├── scripts/                   # lint formatter、依赖补齐脚本等
└── utils/                     # 格式化和通用工具

eslint-plugins/                # 本地 ESLint 规则插件
├── expo/
├── fontawesome6/
├── forbid-emoji/
├── react-native/
├── reanimated/
└── restrict-linear-gradient/

server/
├── src/index.ts               # Express 入口，当前提供 /api/v1/health
└── build.js
```

### CodeGraph 使用规则

- 大范围改动前优先运行 `codegraph sync .` 更新索引；如果目录结构、依赖关系或规则文件发生明显变化，运行 `codegraph index --force .` 做全量刷新
- 需要理解影响面时，优先使用 `codegraph query <symbol> -p .`、`codegraph callers <symbol> -p .`、`codegraph callees <symbol> -p .`、`codegraph impact <symbol> -p .`
- 写入或更新规则前，用 `codegraph files --path . --format tree --max-depth 3 --no-metadata` 对照真实结构，避免沿用过期模板
- `codegraph status --json .` 的 `pendingChanges` 应作为判断索引是否落后的依据

## 样式方案

基于 tailwindcss 进行样式开发（底层基于 Uniwind）

写法示例：

```tsx
<View className="flex-1 bg-white dark:bg-gray-900 p-4"></View>
```

```tsx
<Text
  className="text-lg font-bold text-gray-900 dark:text-white"
  selectionColorClassName="accent-blue-500"
>
  Hello World
</Text>
```

Uniwind 官方文档：https://docs.uniwind.dev/llms.txt

## 如何进行静态校验（TSC + ESLint）

```bash
# 对 client 和 server 目录同时进行校验
pnpm -w lint:all

# 对 client 目录进行校验
pnpm -w lint:client

# 对 server 目录进行校验
pnpm -w lint:server
```

## 如何修改主题模式（跟随系统、固定暗色、固定亮色）

默认为跟随系统，如果用户明确指定为“暗色”或“亮色”，需要修改 `client/components/ColorSchemeUpdater.tsx` 的 `DEFAULT_THEME` 变量为合适的值

## 如何定制主题 design tokens

当前项目的**设计系统**基于 tailwindcss 实现，核心入口文件为 `client/global.css`，如果需要定制主题，应该**阅读并修改 `client/global.css` 文件**

## 路由及 Tab Bar 实现规范

当前项目采用 **Stack + Tabs**：

```text
client/app/
├── _layout.tsx
├── (tabs)/
│   ├── _layout.tsx
│   ├── index.tsx      # 首页 -> screens/home
│   ├── holdings.tsx   # 持仓 -> screens/holdings
│   ├── market.tsx     # 行情 -> screens/market
│   ├── dca.tsx        # 定投 -> screens/dca
│   └── profile.tsx    # 我的 -> screens/profile
├── add-holding.tsx
├── add-transaction.tsx
├── add-dca.tsx
├── instrument-detail.tsx
├── dca-detail.tsx
├── search-quote.tsx
└── +not-found.tsx
```

### 路由文件规则

- `client/app` 下除 `_layout.tsx`、`(tabs)/_layout.tsx`、`+not-found.tsx` 外，页面路由应保持极薄，只做 `export { default } from "@/screens/<name>";`
- 页面实现放在 `client/screens/<name>/index.tsx`，不要把业务页面直接写进路由文件
- 当前存在 `(tabs)/index.tsx`，因此不要新建 `client/app/index.tsx`；它的优先级会高于 `(tabs)/index.tsx`，导致首页不显示 Tab Bar
- 新增 Tab 时，同时改 `client/app/(tabs)/_layout.tsx` 和对应的 `client/app/(tabs)/<route>.tsx`，并确保 `name` 与文件名完全一致
- 新增 Tab 外页面时，在 `client/app/_layout.tsx` 注册 `Stack.Screen`，再创建对应的薄路由文件和 `screens` 页面实现

### 根布局规则

在改动 `client/app/_layout.tsx` 前，必须先阅读该文件。以下逻辑必须保留：

- `import '../global.css';`，这是 tailwindcss/Uniwind 生效的关键
- `<Provider>` 包裹整个 `<Stack>`
- `<Toast />` 位于 `Provider` 内、`Stack` 后
- `Stack` 保持 `headerShown: false`，现有 modal 页面继续使用 `presentation: 'modal'`

### Tab 布局规则

在改动 `client/app/(tabs)/_layout.tsx` 前，必须先阅读该文件。以下逻辑必须保留：

- 使用 `useSafeAreaInsets()` 计算底部安全区
- 使用 `useCSSVariable(['--color-background', '--color-muted', '--color-accent', '--color-border'])` 读取主题变量
- Web 端 `tabBarStyle.height` 必须保持为 `'auto'`
- Tab 图标使用 `@expo/vector-icons` 的 `FontAwesome6`，图标名必须通过 `fontawesome6/valid-name` 校验

## 数据层与状态规则

- SQLite 入口是 `client/db/index.ts` 的 `getDB()`，它负责打开 `portfolio.db`、执行 schema 初始化、写入默认账户和默认设置
- 业务数据访问按领域拆分在 `client/db/accounts.ts`、`alerts.ts`、`calculations.ts`、`dca.ts`、`instruments.ts`、`prices.ts`、`quotes.ts`、`settings.ts`、`transactions.ts`
- 类型定义集中在 `client/db/types.ts`；新增表、字段或返回结构时必须同步类型
- 数据库模块内部通过 `import { getDB } from './index';` 复用连接，不要在业务模块里直接重复 `SQLite.openDatabaseAsync`
- `client/contexts/AppContext.tsx` 会在启动时调用 `getDB()` 并读取 settings；修改初始化流程时必须确认 `isReady`、`settings`、`refreshTrigger` 语义不变
- 交易、定投、行情、设置相关页面优先复用 `client/db` 现有领域函数，不要在 screen 中散落 SQL

## 本地 ESLint 规则

`client/eslint.config.mjs` 已启用仓库内的自定义规则插件。新增代码必须满足以下约束：

- `fontawesome6/valid-name`：`FontAwesome6` 图标名必须来自 `eslint-plugins/fontawesome6/names.js`，不要使用 FontAwesome5-only 名称
- `reanimated/ban-mix-use`：避免混用不兼容的 Reanimated 用法
- `forbidEmoji/no-emoji`：代码和界面文案中禁止使用 Emoji
- `restrictLinearGradient/no-linear-gradient-backgroundcolor`：不要把 `LinearGradient` 当成普通背景色容器滥用
- `expo/require-globalcss-and-provider`：必须保留 Expo 根布局中的 `global.css` 和 `Provider`
- `reactnative/wrap-horizontal-scrollview-inside-view`：横向 `ScrollView` 需要按规则包裹，避免 React Native 布局问题
- `no-warning-comments` 禁止新增以 `TODO` 开头的注释
- 禁止在代码中使用 `via.placeholder.com`

## 依赖管理与模块导入规范

### 依赖安装
**禁止**使用 `npm` 或 `yarn`，按目录区分安装命令：

| 目录 | 安装命令 | 说明 |
|------|----------|------|
| `client/` | `npx expo install <package>` | Expo 会自动选择与 SDK 兼容的版本 |
| `server/` | `pnpm add <package>` | 使用 pnpm 管理后端依赖 |

```bash
# client 目录（Expo 项目）
cd client && npx expo install expo-camera expo-image-picker

# server 目录（Express 项目）
cd server && pnpm add axios cors
```

**网络问题处理**：`npx expo install` 可能因网络原因失败，失败时重试 2 次，仍失败则改用 `pnpm add` 安装

## Expo 开发规范

### 路径别名

Expo 配置了 `@/` 路径别名指向 `client/` 目录：

```tsx
// 正确
import { Screen } from '@/components/Screen';

// 避免相对路径
import { Screen } from '../../../components/Screen';
```

## 本地开发

`coze dev`：用来首次启动前后端服务，也可以用来重启前后端服务（该命令会先尝试杀掉占用端口的进程，再启动服务）
