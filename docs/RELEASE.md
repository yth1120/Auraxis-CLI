# Release Checklist

发布前执行：

```bash
npm run version:check
npm run check
npm run pack:check
npm run build:native
npm run e2e:native
npm run e2e:lsp
npm run e2e:live
```

确认无遗漏后创建 tag，例如 `v1.0.0`。Release workflow 会先在 Linux 上运行完整检查，再依次发布：

1. `@auraxis/core`
2. `@auraxis/cli`
3. 8 个平台的原生二进制与 `SHA256SUMS.txt`

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
