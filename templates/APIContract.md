---
title: "API Contract: [端点名称]"
purpose: "定义 API 接口契约，作为前后端协作的单一事实来源"
tags: ["api-contract", "contract"]
task_id: ""
agent_instance: ""
artifact_id: ""
version: "v1"
---

# API Contract: [端点名称]

## 基本信息

| 属性 | 值 |
|------|-----|
| **端点** | `[METHOD] /api/v1/...` |
| **版本** | v1 |
| **状态** | Draft / Stable / Deprecated |
| **负责人** | @backend / @frontend |

## 鉴权

| 方式 | 说明 |
|------|------|
| 类型 | Bearer Token / Cookie / API Key |
| Header | `Authorization: Bearer <token>` |
| 权限 | `user:read` / `admin:write` |

## 请求 (Request)

### Headers

```
Content-Type: application/json
Authorization: Bearer <token>
```

### Query Parameters

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| | | | | |

### Path Parameters

| 参数 | 类型 | 说明 |
|------|------|------|
| | | |

### Body

```json
{
  
}
```

## 响应 (Response)

### 成功响应 (2xx)

```json
{
  "success": true,
  "data": {
    
  }
}
```

### 错误响应

| 状态码 | 错误码 | 说明 |
|--------|--------|------|
| 400 | `INVALID_INPUT` | 请求参数校验失败 |
| 401 | `UNAUTHORIZED` | 未授权 |
| 403 | `FORBIDDEN` | 无权限 |
| 404 | `NOT_FOUND` | 资源不存在 |
| 500 | `INTERNAL_ERROR` | 服务器内部错误 |

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message",
    "details": {}
  }
}
```

## 分页 (Pagination)

> 如适用

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `page` | integer | 1 | 页码 |
| `limit` | integer | 20 | 每页数量 |
| `cursor` | string | - | 游标（替代 page） |

响应中的分页信息：

```json
{
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "hasMore": true
  }
}
```

## 示例

### 请求示例

```bash
curl -X [METHOD] \
  'https://api.example.com/api/v1/...' \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

### 响应示例

```json
{

}
```

## 变更历史

| 版本 | 日期 | 变更说明 | 作者 |
|------|------|----------|------|
| v1 | YYYY-MM-DD | 初始版本 | |

---

> **协作备注**：前端/后端可在此处添加疑问或确认
