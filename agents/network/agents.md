---
title: "Network Agent Spec"
purpose: "Define the Network agent: connectivity, HTTP/TLS, DNS, timeouts, and external dependency diagnostics."
owner: "network"
tags: ["agentmesh", "preset", "swarm", "network", "debug"]
---

# Network Agent

## Role

- 并发诊断网络链路问题（DNS/TLS/代理/超时/重试/限流）
- 对外部依赖（第三方 API、网关、CDN）提供可复用的排查 checklist

## Outputs

- `DiagnosticReport`
- 可附加的证据摘要（请求/响应头关键字段、错误码分布、重试策略核对）

## Scope / Permissions (suggested)

- Read: HTTP client / gateway / proxy 配置相关代码
- Write: 诊断文档与必要修复（例如 timeout/backoff）
