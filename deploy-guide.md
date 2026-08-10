---
AIGC:
  ContentProducer: '001191110102MAD55U9H0F10002'
  ContentPropagator: '001191110102MAD55U9H0F10002'
  Label: '1'
  ProduceID: '87e7f244-ccc8-4b5b-ab6d-fef6d0e960ed'
  PropagateID: '87e7f244-ccc8-4b5b-ab6d-fef6d0e960ed'
  ReservedCode1: 'a2eee93b-7285-42b1-a40a-f95e91324c94'
  ReservedCode2: 'a2eee93b-7285-42b1-a40a-f95e91324c94'
---

# IntelliSign Radar 云端部署指南

## 一、注册 GitHub 账号

1. 打开浏览器，访问 https://github.com/signup
2. 填写用户名、邮箱、密码，完成人机验证
3. 登录邮箱，点击验证链接
4. 选择 Free 免费方案，完成注册

## 二、创建 GitHub Personal Access Token

1. 登录 GitHub 后，点击右上角头像 → **Settings**
2. 左侧菜单拉到最底部 → **Developer settings**
3. 选择 **Personal access tokens** → **Tokens (classic)**
4. 点击 **Generate new token (classic)**
5. Note 填写：`intellisign-radar-deploy`
6. Expiration 选择：`30 days`
7. 勾选权限：
   - **repo**（全部子项：Full control of private repositories）
   - **delete_repo**
8. 点击 **Generate token**
9. **立即复制 Token**（页面关闭后无法再查看！）

## 三、运行自动上传脚本

打开 PowerShell，进入项目目录，执行：

```
cd "C:\Users\金总\.local\share\TeleAgent\TeleAgent的工作空间\intellisign-radar"

$env:GITHUB_USERNAME = "你的GitHub用户名"
$env:GITHUB_TOKEN = "你的GitHub Token"

node deploy-to-github.js
```

脚本会自动：
- 创建 GitHub 仓库 `intellisign-radar`
- 上传全部 25 个源代码文件
- 输出仓库地址

## 四、在 Render 上部署

1. 打开浏览器，访问 https://render.com
2. 点击 **Get Started** 或 **Sign Up**
3. 选择 **Sign up with GitHub**，授权 Render 访问你的 GitHub
4. 登录后进入 Dashboard，点击 **New +** → **Web Service**
5. 在仓库列表中找到 `intellisign-radar`，点击 **Connect**
6. 部署配置：
   - **Name**: `intellisign-radar`
   - **Region**: `Oregon` 或 `Frankfurt`（选离国内近的）
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: `Free`
7. 点击 **Advanced** → **Add Environment Variable**：
   - Key: `PORT`，Value: `10000`
8. 点击 **Create Web Service**
9. 等待 3-5 分钟，构建和部署自动完成

## 五、验证部署

- Render 会分配一个地址，格式如：`https://intellisign-radar.onrender.com`
- 打开该地址，应看到 IntelliSign Radar 仪表盘
- 点击 **立即采集** 测试数据采集功能
- 点击 **生成周报** 测试简报生成

## 六、定时任务说明

系统内置以下自动任务（无需额外配置）：

| 任务 | 时间 | 说明 |
|------|------|------|
| 每日数据采集 | 每天 08:30 | 自动采集政策法规、竞品、伙伴动态 |
| 每日简报 | 每天 18:00 | 自动生成日报摘要 |
| 每周简报 | 每周一 09:00 | 自动生成本周情报汇总 |

注意事项：
- Free 方案的服务会在 15 分钟无访问后休眠
- 首次访问需等待约 30 秒冷启动
- 建议用外部监控（如 UptimeRobot）每 5 分钟 ping 一次，防止休眠

## 七、常见问题

**Q: Render 部署失败？**
A: 检查 Build Log，常见原因是 Node 版本不匹配。项目要求 Node >= 18。

**Q: 采集数据为空？**
A: 百度搜索可能因频繁请求被限流，建议手动点"立即采集"并等待 2-3 分钟。

**Q: 如何更换监控关键词？**
A: 在系统设置页面修改"政策监控关键词"等配置项。

**Q: 数据会丢失吗？**
A: Free 方案下数据库存储在 Render 的临时文件系统中，重启会丢失。建议定期导出数据。

> AI生成