# 行旅手账 · 私人旅行工作台

手机网页：自然语言辅助填表 → API 自动规划 → 三套完整 PNG 长图 → 修改、版本回看与私人云端保存。

## 页面与长图

- 新建：规则识别免费，AI 识别通过模型调用。先预览，再填入表单，默认保护手动编辑。
- 攻略：长图、按天查看、手动编辑、导航、完成标记、锁定项目、AI 调整差异确认。
- 历史：攻略、版本、下载与主动分享。
- 我的：邀请注册、登录、模型配置、预算预留、备份。

三套模板为清晰实用、旅行手账、简洁分享。图片包含总览、地图或明确标注的顺序示意、具体时间和提醒。AI 生成内容及插画，程序排版中文。长内容连续分段，不缩小字体或截掉内容。切换模板、编辑和重新排版不调用 AI。新攻略确认后自动补全已配置的图片与地图；重名地点须选择。公共交通地图连线为步行路线，公共交通建议见时间轴并在地图 App 核对。

## 免费云后台

GitHub Pages 承载前端，Supabase Free 承载 Auth、数据库、私有图片与 Edge Function。不购买服务器、域名或付费套餐。AI、地图、检索额度由各服务商决定；免费后台有额度、休眠与执行时限，不承诺永久免费或网络始终可达。

1. 执行 supabase/migrations/202610150001_private_travel.sql。
2. 关闭公开 Auth sign-up。邀请注册由后端验证一次性令牌，再使用托管 Auth 创建账号。
3. 服务端设置 TRAVEL_ENCRYPTION_KEY（32字节 base64）和 TRAVEL_ORIGIN（网页 origin）。平台提供 Supabase URL、service-role 环境变量。
4. 部署命令：npx supabase functions deploy travel-api --use-api --no-verify-jwt --import-map supabase/functions/deno.json --project-ref YOUR_REF
5. 函数逐请求调用 Auth getUser、检查成员及数据归属。平台旧 JWT 检查关闭用于公开健康检查、邀请和分享，私人操作仍严格鉴权。
6. src/cloud-project.json 只放项目 URL 和 anon/publishable 公开密钥。管理令牌、service-role、模型密钥绝不提交。
7. 初始所有者邀请通过本机私人文件交付。后续可生成绑定邮箱、7天、一次有效的邀请链接。

邀请持有权用于注册，邮箱作为登录名。当前没有邮件验证和自助密码找回，账号恢复由所有者在托管 Auth 控制台处理。

## API 与预算

文字模型接入 pi AI 1.2.0，支持 OpenAI Completions、Responses、Anthropic、Gemini。运行环境在发送请求前不兼容 SDK 时可回退官方 HTTP，不自动重复已发出的付费调用。图片支持兼容 Images API 与 Gemini 图片接口，独立配置。服务商允许远程网站使用的 API/套餐密钥可接入；ChatGPT Plus/Pro 登录不是通用 API。

密钥使用 AES-GCM 加密并绑定账号。可选 Tavily 查询与高德 Web服务 Key；文字模型不自动等于联网能力。无来源标待核验；无地图配置显示顺序示意，不伪造坐标。

预算采用事务内请求预留和幂等编号，不是供应商实际账单。失败和超时保守保留预留，需同时在供应商设置额度上限。云端乐观版本校验阻止多设备静默覆盖，保留最近12个版本；本机保留40个；图片去重存储。

## 隐私、离线与迁移

原本机数据保留，登录后使用账号独立缓存，不自动上传旧数据。迁移时退出登录导出备份，再登录导入；云端导入创建新攻略，旧备份的历史修订不逐条上传。已缓存攻略可离线阅读与导出，云端保存、AI调用需联网；离线修改排队同步尚未实现。

分享默认私有，主动开启后30天到期，可撤销；服务端隐藏详细起点、返回地点、费用、个人记录及地理地图。已经下载转发的图片无法收回。只在自己的设备保持登录，浏览器缓存由设备管理。

## 验证

npm ci
npm run build
npm test
npx deno check --config supabase/functions/deno.json supabase/functions/travel-api/index.ts
npx deno test --config supabase/functions/deno.json --allow-env --allow-net --allow-read --allow-sys supabase/functions/travel-api/security_test.ts

验证时间取舍、备份、识别保护、账号缓存隔离、脱敏、三套长图内容与分段，以及Deno加密、防内网请求、pi AI受控传输。真实供应商生成和真实地图需配置有效凭据后验收。
