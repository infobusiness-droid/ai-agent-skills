"""外部工具适配器（workbuddy 预留）：通过命令模板调用外部 CLI，输出作为智能体回复。

workbuddy 目前为预留状态：用户在「设置」中配置 command_template（{prompt} 为任务内容占位符）
与 workdir 后即可启用。待用户提供 workbuddy 的 API/CLI 接口文档后，在此实现正式协议。
"""
import asyncio
import subprocess

from . import providers


class CLIAdapterError(Exception):
    pass


async def run_cli(command_template: str, workdir: str, prompt: str) -> str:
    if not command_template:
        raise CLIAdapterError("未配置命令模板，请在「设置 → workbuddy 适配器」中填写。")
    command = command_template.replace("{prompt}", prompt)
    proc = await asyncio.create_subprocess_shell(
        command,
        cwd=workdir or None,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=600)
    except asyncio.TimeoutError:
        proc.kill()
        raise CLIAdapterError("外部命令执行超时（>10 分钟）。")
    out = stdout.decode("utf-8", "replace")
    if proc.returncode != 0:
        raise CLIAdapterError(f"外部命令退出码 {proc.returncode}：\n{out[-800:]}")
    return out
