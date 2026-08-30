const files: string = String(await tools.ListFiles({ path: "." }));
console.log(
  typeof files === "string" && files.includes("native-code-smoke.ts")
    ? "native-code-tools-ok"
    : "native-code-tools-missing",
);
