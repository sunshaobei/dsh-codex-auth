# dsh-codex-auth

DeepSeek Harness 客户端插件：在设置面板中管理 **Codex 订阅（ChatGPT OAuth）授权**，无需 API key 使用 Codex 订阅内的 GPT 模型。

## 功能

- **设置页「Codex 订阅」**：授权状态徽章（已授权 / 已过期 / 未授权）、有效期倒计时、账号邮箱、订阅类型（Plus/Pro）
- **一键授权**：点击后宿主进程运行完整 OpenAI OAuth 浏览器流程（PKCE S256，`localhost:1455` 回调，与 Codex CLI 同端口），成功后把 grant 凭证写入 `~/.dsh/.credentials.yaml` 的 `llm-pi-ai/openai-codex` 记录 —— 与 dsh-llm-pi-ai 读写的是同一条记录，模型目录即时刷新
- **过期自动弹窗**：当前会话选中的模型路由到 `openai-codex` 且凭证过期时，弹出重新授权对话框（可稍后，10 分钟内不再打扰）

## 架构

双面插件（模板来自 dsh-balance-panel）：

- **宿主面** `lib/index.js`：loopback RPC 通道 `/dsh-codex-auth`（status / login / logout），OAuth 常量与 `@earendil-works/pi-ai` 的 openai-codex 适配器一致
- **客户端面** `lib/client.js`：`settings.section`（id `codex-subscription`，order 25）+ `shell.overlay` 过期弹窗；通过 `ctx.connection.rpc.call` 与宿主通信；订阅 `credentials/record-updated` 事件实时刷新状态

凭证记录由 llm-pi-ai 的自动 refresh 机制维护（access token 约 10 天过期，refresh 自动续期）；refresh 也失效时本插件的弹窗接管。

## 构建 / 安装

```bash
npm run build                      # src/*.ts -> lib/*.js
cd ~/.dsh/profiles/desktop
# package.json: dependencies += "dsh-codex-auth": "file:/Users/sunshaobei/.dsh/dsh-codex-auth"
#               dsh.profile.bundles += "dsh-codex-auth"
npm install                        # 以 symlink 方式安装本地插件
# 重启 DeepSeek Harness 客户端生效
```

## 文件

- `src/index.ts` — 宿主：OAuth 流程 + RPC
- `src/client.ts` — 设置页 + 弹窗
- `src/vendor/` — vendored schemastery/cosmokit（link 安装时解析不到内部包）
- `cordis.patch.yml` — profile 层 insert 配置

## 授权状态与验证

登录请求立即返回，授权期间面板每秒查询进度，窗口重新获得焦点时立即刷新。回调只有在 token 交换、凭证保存和读取校验成功后才显示成功，并尝试打开 `dsh://open`；浏览器拦截自动唤起时可点击返回按钮。交换请求设有 30 秒超时，授权等待为 5 分钟，失败原因同时显示在回调页和订阅面板。

运行 `npm test` 验证回调状态校验、保存成功、磁盘写入失败、token 交换失败、拒绝授权、重复登录和端口占用。测试使用模拟 OAuth 服务，不读取个人凭证。构建后重启 DeepSeek Harness 加载新的宿主插件。

授权有效时，插件通过宿主 `settings.mutate` 自动提交 `openai-codex` 提供商，使用宿主内置目录并验证模型数量。已有提供商配置会保留，配置写入或目录加载失败会显示在订阅面板；不会切换当前默认模型。当前设置导航不提供自定义图标接口，因此插件仅对自身导航按钮添加 ChatGPT 图标样式，并在卸载时清理。图标来自 Simple Icons v14 的 OpenAI 标志（CC0）。
