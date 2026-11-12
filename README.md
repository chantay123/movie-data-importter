# Movie Data Importer

Công cụ nạp dữ liệu phim từ các file `.txt` vào MongoDB của project `MovieStreaming`.

Quy trình đầy đủ:

```text
Upload Folder
     |
     v
Read TXT Files          -> trạng thái từng file theo thời gian thực (SSE)
     |
     v
Parse TXT -> JSON
     |
     v
Validate JSON
     |
     v
Map sang schema Movie (dùng đúng model của crawl-data-movie)
     |
     v
Compare MongoDB  (sourceId -> tmdb.id -> slug -> name -> originName)
     |
     v
Show Old Data vs New Data (diff từng field, chọn field muốn cập nhật)
     |
     v
Confirm Import  (dry-run mặc định)
     |
     v
Import to MongoDB ($set theo field, giữ nguyên dữ liệu thiếu)
     |
     v
Verify Import Result -> Success / Failed + Import History
```

## Cấu trúc thư mục

```text
Movie-Data-Importer/
├── backend/                # Express + TypeScript API
│   ├── src/
│   │   ├── config/         # đọc cấu hình từ .env
│   │   ├── constants/      # ImportStatus, ProcessingStage, MatchStatus, FieldStatus
│   │   ├── database/       # kết nối MongoDB + bridge tới model Movie của crawler
│   │   ├── middleware/     # adminAuth
│   │   ├── routes/         # /api/import/*
│   │   ├── server/         # app.ts, index.ts
│   │   ├── services/       # parser, validator, mapper, matcher, diff, import, job
│   │   ├── types/          # kiểu dữ liệu dùng chung
│   │   └── utils/          # normalizeText, normalizeSlug, dateMapper
│   └── tests/              # Vitest (49 test, không cần database thật)
└── frontend/               # React 18 + Vite admin panel
    └── src/
        ├── components/     # FolderUploader, ImportDashboard, FileProgressTable,
        │                   # JsonPreview, DatabaseComparison, FieldDiffViewer,
        │                   # ImportConfirmation, ImportHistory
        ├── hooks/          # useFolderUpload, useImportProgress, useDatabaseComparison
        ├── services/       # importerApi.service.ts
        ├── types/          # kiểu dữ liệu dùng chung
        └── utils/          # format.ts
```

## Cài đặt

```bash
npm run install:all
```

## Cấu hình

Backend đọc `.env` theo thứ tự:

1. `backend/.env`
2. `Movie-Data-Importer/.env`
3. `crawl-data-movie/.env` (dùng `CRAWLER_PROJECT_PATH` để trỏ đúng thư mục)

Copy mẫu và chỉnh giá trị:

```bash
copy backend\.env.example backend\.env
copy frontend\.env.example frontend\.env
```

Frontend cần `VITE_IMPORTER_API_KEY` trùng với `IMPORT_ADMIN_API_KEY` của backend
(hoặc dùng JWT admin của project chính).

## Chạy

```bash
npm run dev:backend    # http://localhost:4100
npm run dev:frontend   # http://localhost:4173
```

Kiểm tra backend:

```bash
curl http://localhost:4100/health
```

## Kiểm tra chất lượng

```bash
npm run lint
npm run typecheck
npm run test      # Vitest: 6 file test, 49 test
npm run build
```

## API chính

| Method | Path | Mô tả |
| --- | --- | --- |
| GET | `/health` | Trạng thái service + kết nối database |
| POST | `/api/import/jobs` | Tạo job từ danh sách file đã đọc |
| GET | `/api/import/jobs/:jobId` | Trạng thái job + tiến trình từng file |
| GET | `/api/import/jobs/:jobId/stream` | SSE realtime (fallback polling) |
| POST | `/api/import/jobs/:jobId/cancel` | Hủy job đang chạy |
| POST | `/api/import/jobs/:jobId/files/:fileId/retry` | Retry riêng một file lỗi |
| POST | `/api/import/jobs/:jobId/files/:fileId/import` | Import một file (dry-run hoặc xác nhận) |
| GET | `/api/import/history` | Lịch sử import |
| GET | `/api/import/export` | Xuất JSON hợp lệ (không có cú pháp Mongo Shell) |
| GET | `/api/import/fields` | Danh sách field được phép cập nhật |

## Quy tắc an toàn dữ liệu

- Field không có trong TXT bị bỏ qua, không bao giờ ghi `null` / `""` / `0` / `false`.
- Field hệ thống (`_id`, `createdAt`, `viewCount`, `rating`, `statCd`, `effDate`, `dateLastMain`)
  được đánh dấu protected và không thể ghi đè.
- Vận hành cập nhật dùng `$set` từng field, không dùng `replaceOne` toàn document.
- Ghi đè chỉ khi có dữ liệu mới hợp lệ; kiểm tra `updatedAt` trước khi ghi (optimistic concurrency).
- Kết quả `AMBIGUOUS` không được import cho tới khi người dùng chọn bản ghi cụ thể.
- `episodes` được merge theo server + ngôn ngữ + số tập, giữ `_id` cũ, không tạo tập trùng.
- Mặc định chạy dry-run; chỉ ghi database khi người dùng xác nhận.
- Lỗi của một file không dừng cả batch; mỗi file ghi log riêng và có thể retry.
