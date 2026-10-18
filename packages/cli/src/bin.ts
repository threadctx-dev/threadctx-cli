import { main } from "./cli.js";

const code = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  isTTY: Boolean(process.stdout.isTTY),
  now: () => new Date(),
  stdin: process.stdin,
});
process.exitCode = code;
