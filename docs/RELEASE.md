# Release Checklist

发布前执行：

```bash
npm run version:check
npm run check
npm run test:practical
npm run e2e:app-server
npm run e2e:sdk
npm run pack:check
npm run build:native
npm run e2e:native
npm run e2e:lsp
npm run e2e:live
```

确认无遗漏后创建 tag，例如 `v1.1.0`（tag 必须与 `package.json` 的版本号一致）。
Release workflow 会先在 Linux 上运行完整检查，再依次发布：

1. 8 个平台的原生二进制与 `SHA256SUMS.txt`（上传到对应的 GitHub Release）
2. `@auraxis/core`（需要仓库 Secret `NPM_TOKEN`）
3. `@auraxis/cli`（同上）

### npm 发布

推荐使用 **Trusted Publishing（OIDC）**，不需要任何长期 token：

1. 首次发布前，包在 npm 上还不存在，Trusted Publisher 只能配置在已发布的包上，
   因此第一次发布需要一个一次性凭据：在 npm 生成 Granular Access Token，
   勾选 **Bypass two-factor authentication (2FA)**，Packages and scopes 选
   `@auraxis` 的 Read and write，Organizations 选 `auraxis` 的 Read and write。
2. 把这个 token 配到仓库 Secret `NPM_TOKEN`，重跑 Release workflow 完成首次发布。
3. 到 npm 包设置页（`@auraxis/core`、`@auraxis/cli` 各一次）→ **Trusted Publisher**
   → 选 GitHub Actions，填：
   - Organization or user：`yth1120`
   - Repository：`Auraxis-CLI`
   - Workflow filename：`release.yml`
   - 勾选允许 `npm publish`（默认只允许 staged publish）
4. 删除仓库 Secret `NPM_TOKEN`，并在 npm 上 Revoke 那个一次性 token。
   之后每次 Release 都用 OIDC 短时令牌发布，无需轮换任何凭据。

发布路径由 workflow 自动选择：存在 `NPM_TOKEN` 时用它，否则用 OIDC。
原生二进制上传偶发被 GitHub 侧 500（`Error saving asset`）拒绝时会自动重试 3 次，
且不会阻断 npm 发布。

原生二进制由 `bun build --compile` 在 CI 中交叉编译，上传到同一个 GitHub
Release。npm 包只包含 `main.js` / `single.js`，原生文件放在
`packages/cli/native/`，不会进入 npm tarball。

发布后安装到临时目录做最后验证：

```bash
npm install -g @auraxis/cli
auraxis --version
auraxis --doctor
```

原生二进制可直接下载任一平台文件验证：

```bash
./auraxis-linux-x64 --version
./auraxis-windows-x64.exe --doctor
```
