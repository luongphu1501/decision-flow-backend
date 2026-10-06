# DecisionFlow Studio Backend

Backend MVP cho ứng dụng thiết kế và vận hành workflow phê duyệt bằng graph. API dùng NestJS, PostgreSQL, Prisma, JWT demo authentication và REST/OpenAPI.

## Chức năng đã có

- Demo login, JWT ngắn hạn, RBAC và kiểm tra ownership/assignment ở server.
- Workflow draft, autosave dùng optimistic concurrency (`baseRevision`), duplicate và archive.
- Graph validation authoritative với giới hạn 50 node/100 edge.
- Simulation có trace giải thích condition, nhánh đã chọn và trạng thái pause tại Review.
- Publish thành snapshot bất biến, version history và structured diff.
- Submit request theo active version, `Idempotency-Key`, routing đồng bộ.
- Reviewer inbox và approve/reject đúng một lần trong transaction.
- Timeline/audit theo phạm vi quyền, request ID, JSON access log và database health check.
- Swagger, migration, seed idempotent, unit test và E2E lifecycle test.

## Kiến trúc

```mermaid
flowchart LR
  HTTP[REST Controllers] --> APP[Application Services]
  APP --> DOMAIN[Pure graph domain]
  APP --> PRISMA[Prisma repositories]
  DOMAIN --> VALIDATE[Validation]
  DOMAIN --> SIMULATE[Simulation / routing]
  DOMAIN --> DIFF[Version diff]
  PRISMA --> PG[(PostgreSQL)]
  GUARDS[JWT + Roles guards] --> HTTP
  FILTER[Stable error filter] --> HTTP
```

`src/domain/graph` là TypeScript thuần, không phụ thuộc NestJS, HTTP, Prisma hoặc thư viện canvas. Request routing tái sử dụng chính simulation engine để preview và execution không sai khác nhau.

## Chạy bằng Docker

Yêu cầu Docker Engine/Desktop đang chạy.

```bash
cd backend
docker compose up --build
```

Compose sẽ khởi động PostgreSQL, chạy migration, seed và API. Dữ liệu PostgreSQL nằm trong named volume `decisionflow_pgdata`.

- API: `http://localhost:3000/api/v1`
- Swagger: `http://localhost:3000/api/docs`
- Health: `http://localhost:3000/api/v1/health`

## Chạy local

Yêu cầu Node.js 22 LTS và PostgreSQL 16+.

```bash
cd backend
cp .env.example .env
npm ci
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run dev
```

Seed có thể chạy nhiều lần mà không tạo trùng workflow, version, request, decision hoặc audit fixture.

## Biến môi trường

| Tên                      |        Bắt buộc | Mặc định/ý nghĩa                          |
| ------------------------ | --------------: | ----------------------------------------- |
| `DATABASE_URL`           |              Có | PostgreSQL connection string              |
| `JWT_SECRET`             | Có ở deployment | Secret tối thiểu 32 ký tự                 |
| `JWT_EXPIRES_IN_SECONDS` |           Không | `7200` (2 giờ)                            |
| `PORT`                   |           Không | `3000`                                    |
| `CORS_ORIGINS`           |           Không | Danh sách origin, phân cách bằng dấu phẩy |
| `NODE_ENV`               |           Không | `development` hoặc `production`           |

Không commit file `.env`.

## Tài khoản demo

Không có password. Gọi `POST /api/v1/auth/demo-login` với email:

| Email                  | Role      | Reviewer role |
| ---------------------- | --------- | ------------- |
| `designer@demo.local`  | DESIGNER  | —             |
| `reviewer@demo.local`  | REVIEWER  | FINANCE       |
| `requester@demo.local` | REQUESTER | —             |
| `teamlead@demo.local`  | REVIEWER  | TEAM_LEAD     |

Tài khoản Team Lead bổ sung để kiểm thử assignment mismatch và workflow có nhiều reviewer role.

Ví dụ:

```bash
curl -X POST http://localhost:3000/api/v1/auth/demo-login \
  -H 'Content-Type: application/json' \
  -d '{"email":"designer@demo.local"}'
```

## Autosave và revision conflict

Draft bắt đầu ở revision 1. Mỗi lần lưu phải gửi revision mà client đang giữ:

```json
{
  "baseRevision": 7,
  "clientSequence": 18,
  "nodes": [],
  "edges": [],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

Update database chỉ thành công khi revision hiện tại vẫn bằng 7 và sau đó tăng đúng một lần thành 8. Nếu tab khác đã lưu trước, API trả HTTP 409:

```json
{
  "code": "DRAFT_REVISION_CONFLICT",
  "message": "Draft has changed since revision 7.",
  "details": { "baseRevision": 7, "latestRevision": 9 },
  "requestId": "api_req_...",
  "timestamp": "..."
}
```

Frontend phải giữ graph local và cho người dùng chọn reload server version hoặc duplicate local work; không tự ghi đè.

## Publish, version và request routing

1. Publish yêu cầu `expectedRevision`, validate graph lại ở server và tạo `WorkflowVersion.graphSnapshot` mới.
2. Snapshot không có API update/delete. Draft vẫn tiếp tục chỉnh độc lập.
3. Submit request đọc `activeVersionId` trong transaction và lưu cố định `workflowVersionId`.
4. Graph chạy đến Review hoặc terminal. Trace được lưu trong `Request.routeTrace`.
5. Decision lưu cùng state transition và audit trong một transaction, sau đó routing tiếp từ lịch sử decision.
6. Publish v2 không thay đổi `workflowVersionId` hoặc đường chạy của request đã tạo bằng v1.

## Endpoint chính

Tất cả endpoint trừ demo login và health cần Bearer token.

| Method    | Endpoint                                            | Quyền chính                               |
| --------- | --------------------------------------------------- | ----------------------------------------- |
| POST      | `/api/v1/auth/demo-login`                           | Public, rate-limited                      |
| GET       | `/api/v1/auth/me`                                   | Authenticated                             |
| GET/POST  | `/api/v1/workflows`                                 | List authenticated / create Designer      |
| GET/PATCH | `/api/v1/workflows/:id/draft`                       | Owner Designer                            |
| POST      | `/api/v1/workflows/:id/validate`                    | Owner Designer                            |
| POST      | `/api/v1/workflows/:id/simulate`                    | Owner Designer                            |
| POST      | `/api/v1/workflows/:id/publish`                     | Owner Designer                            |
| GET       | `/api/v1/workflows/:id/versions`                    | Authorized viewer                         |
| GET       | `/api/v1/workflows/:id/versions/:versionId`         | Authorized viewer                         |
| GET       | `/api/v1/workflows/:id/versions/diff?base=&target=` | Authorized viewer                         |
| POST      | `/api/v1/workflows/:id/duplicate`                   | Owner Designer                            |
| POST      | `/api/v1/workflows/:id/archive`                     | Owner Designer                            |
| GET/POST  | `/api/v1/requests`                                  | Own list / authenticated demo user submit |
| GET       | `/api/v1/requests/inbox`                            | Reviewer                                  |
| GET       | `/api/v1/requests/:id`                              | Owner/assigned/related user               |
| POST      | `/api/v1/requests/:id/decision`                     | Assigned Reviewer                         |
| GET       | `/api/v1/activity`                                  | Role-scoped                               |
| GET       | `/api/v1/health`                                    | Public                                    |

Chi tiết DTO và response xem tại Swagger.

## Stable error contract

Mọi lỗi có cùng shape: `code`, `message`, `details`, `requestId`, `timestamp`. Các code frontend cần map gồm `VALIDATION_ERROR`, `AUTH_REQUIRED`, `PERMISSION_DENIED`, `WORKFLOW_NOT_FOUND`, `DRAFT_REVISION_CONFLICT`, `GRAPH_INVALID`, `NO_ACTIVE_WORKFLOW_VERSION`, `IDEMPOTENCY_KEY_REUSED`, `REQUEST_NOT_FOUND`, `REQUEST_ALREADY_DECIDED`, `REVIEW_ASSIGNMENT_MISMATCH`, `SIMULATION_FAILED`, `RATE_LIMITED`, `INTERNAL_ERROR`.

## Test và quality gates

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test:unit
npm run build
```

E2E cần database riêng. Không trỏ lệnh này vào database có dữ liệu cần giữ vì suite sẽ dọn dữ liệu trước khi seed fixture:

```bash
docker compose up -d postgres
docker compose exec postgres createdb -U decisionflow decisionflow_test # chỉ lần đầu
export DATABASE_URL='postgresql://decisionflow:decisionflow@localhost:5432/decisionflow_test?schema=public'
npm run prisma:migrate
npm run test:e2e
```

E2E kiểm tra login/RBAC, autosave concurrent 200/409, invalid graph, simulation, publish snapshot bất biến, v1/v2 request binding, idempotency, assignment mismatch, reason bắt buộc, concurrent decision và transactional audit.

## Giới hạn chủ động của MVP

- Demo authentication, chưa có password/refresh token/SSO.
- Xử lý đồng bộ, chưa có queue, WebSocket, notification hoặc realtime collaboration.
- Chưa upload attachment; description chỉ là metadata request.
- Chưa có organization/team administration hoặc production compliance claim.
- Pagination dùng page/limit; chưa có cursor pagination.
- Rate limiting lưu trong process, phù hợp demo một instance.
- Không chạy JavaScript/expression từ người dùng; condition chỉ dùng field/operator/value cho phép.
