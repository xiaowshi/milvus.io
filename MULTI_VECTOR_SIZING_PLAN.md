# Sizing Tool 支持多个 Vector Field 方案

页面: `/tools/sizing` (Milvus 2.6.x) 与 `/tools/sizing-v250` (2.5.x 及更早)。

## 1. 现状: 计算模型只有一个 vector field

| 位置 | 现状 |
| --- | --- |
| `src/parts/sizingCommon/formSection.tsx` | 表单状态只有一个 `dimension`、一个 `indexTypeParams`、一个 `refine`；UI 是一个 "Vector Dimension" 滑条 + 一个 "Index Type" 下拉 |
| `src/utils/sizingToolCommon.ts` `createRawDataSizeCalculator` | `rawData = num × d × 4 bytes + scalar`，只接收单个 `d` |
| `src/utils/sizingTool.ts` / `sizingToolV250.ts` `memoryAndDiskCalculator` | 以单个 `d` + 单个 `indexType` 走 `switch`，算出一份 memory/disk，再加 `segmentSize × 2` 增长段缓冲，乘 1.15 |
| `dependencyCalculator` | 重新用 `num, d` 算 rawDataSize 推 MinIO / Kafka PVC |
| `$1B768D` 阈值 | 用 `rawDataSize` 判断是否超出可估算范围 |

Scalar 侧已经是多字段表格 (`schemaFields.tsx` + `schema.ts`)，但 vector 侧仍是单字段。

## 2. Milvus 是否支持多个 vector field: 支持

依据 Milvus 源码 (本机 `repos/gitlab/milvus-pr-53296`):

- `configs/milvus.yaml:416` — `proxy.maxVectorFieldNum: 10`，注释为 "The maximum number of vector fields that can be specified in a collection"。
- `pkg/util/paramtable/component_param.go:2760` — 该参数 `Version: "2.4.0"`，默认值 10，可热更新。
- `internal/proxy/task.go:479-485` — CreateCollection 校验: `len(GetVectorFieldSchemas(schema)) > MaxVectorFieldNum` 报错；`== 0` 也报错 (必须至少一个)。AddField (`task.go:1001`) 同样受限。
- `internal/proxy/util.go:77` — `enableMultipleVectorFields = true` 硬编码开启。
- `internal/proxy/impl.go:3475` — 多 vector field 时 search 必须显式给 `anns_field`。
- `pkg/util/typeutil/schema.go:2926` — `GetVectorFieldSchemas` 把 struct array 里的 vector 也计入上限。

官方文档同样说明: `docs/v2.6.x/site/en/userGuide/search-query-get/multi-vector-search.md`，以及 `configure_proxy.md#proxymaxVectorFieldNum`。

对 sizing 的含义:

1. 每个 vector field 各自建索引、各自加载，**内存 / 磁盘按字段求和**。
2. 行数 (Number of Vectors) 是 collection 级别的，所有 vector field 共享同一行数。
3. 上限 10 个 (默认配置)，工具应按 10 限制。
4. 2.4.0 起支持，两个版本页面 (2.6.x、2.5.x) 都适用；2.3 及更早不支持，可在 v250 页面加一句提示。

## 3. 方案

原则: **单个 vector field 时结果与现在完全一致** (回归零变化)，多个时按字段求和。所有改动集中在 `sizingCommon` 与两个 utils，两个版本页面自动受益。

### 3.1 数据模型

新增 `src/parts/sizingCommon/vectorFieldSchema.ts`:

```ts
export interface VectorFieldConfig {
  id: string;
  dimension: number;
  indexTypeParams: IIndexType;   // 原 indexTypeParams，整体挪到字段内
  refineType?: RefineValueEnum;  // 仅 v3 (RABITQ)
}

export const MAX_VECTOR_FIELD_COUNT = 10; // = proxy.maxVectorFieldNum 默认值

export const createVectorField = (config: SizingVersionConfig): VectorFieldConfig
export const totalDimension = (fields: VectorFieldConfig[]) => fields.reduce((s, f) => s + f.dimension, 0);
```

`formSection.tsx` 状态变化:

```ts
// before
form.dimension; indexTypeParams; refine
// after
form.vectorFields: VectorFieldConfig[]   // 初始 1 个，沿用今天的默认值 (768 / FLAT)
```

### 3.2 计算公式

**Raw data size** — 线性于 d，直接传总维度即可，签名不变:

```ts
rawDataSizeCalculator({ num, d: totalDimension(vectorFields), withScalar, scalarAvg })
```

`dependencyCalculator` 与 `$1B768D` 阈值同样传 `d = totalDimension`，不需要改实现。

**Loading memory / disk** — 在 `sizingTool.ts` 与 `sizingToolV250.ts` 中:

1. 把现有 `switch (indexType)` 抽成纯函数 `vectorIndexMemoryAndDisk({ num, d, indexTypeParams, refineType })`，返回单字段 `{ memory, disk }`。
2. `memoryAndDiskCalculator` 参数从 `d, indexTypeParams, refineType` 改为 `vectorFields: VectorFieldConfig[]`，实现:

```ts
const perField = vectorFields.map(f => vectorIndexMemoryAndDisk({ num, ...f }));
const vectorMemory = sum(perField.memory);
const vectorDisk   = sum(perField.disk);

// 增长段缓冲是 collection 级别的，只加一次；
// 沿用现有规则: 全部字段都是 DISKANN 时不加缓冲 (与今天单字段 DISKANN 行为一致)
const needSegBuffer = vectorFields.some(f => f.indexTypeParams.indexType !== IndexTypeEnum.DISKANN);
const vectorLoadingMemory = (vectorMemory + (needSegBuffer ? segmentSizeByte * 2 : 0)) * 1.15;

return {
  memory: vectorLoadingMemory + scalarLoadingMemory,
  disk:   vectorDisk + scalarLocalDisk,
};
```

单字段时与现有代码逐项等价。

3. `SizingVersionConfig.utils.memoryAndDiskCalculator` 类型目前是 `any`，无需改 `types.ts`；建议顺手把 `IIndexType` 复用到 `VectorFieldConfig`。

### 3.3 UI

参考 scalar 的 `SchemaFields` 表格风格，新增 `src/parts/sizingCommon/vectorFields.tsx`:

- 标题 "Vector Fields"，下方每个字段一张卡片:
  - `Vector Field #n` 标签 + 删除按钮 (第一个字段禁用删除，与 PK 行同样处理)
  - `SizingRange` 维度 (复用 `DIMENSION_RANGE_CONFIG`)
  - Index Type `Select` + 现有 `IndexTypeComponent` (props 不变，只是按字段传 `data / onChange / refine / onRefineChange`)
- 底部 "+ Add Vector Field" 按钮，达到 10 个时 disabled，并显示提示 "Milvus 默认最多 10 个 vector field (proxy.maxVectorFieldNum)"。
- 复用 `index.module.css` 里 `schemaTable / schemaRow / schemaDeleteBtn / addFieldBtn` 样式，必要时加 `vectorFieldCard`。

`formSection.tsx` 中删除原来的 "Vector Dimension" 与 "Index Type" 两段，替换为 `<VectorFields fields={form.vectorFields} onChange=... config={config} />`。

"Number of Vectors" 语义变成行数，建议文案改为 "Number of Entities (Rows)"，key 仍用 `form.num`。

`IndexTypeComponent` 内部无需改动: `RABITQComponent` 的 `displayRefine` 本地状态按 `key={field.id}` 各自独立。

### 3.4 结果区 (可选，第二步)

`resultSection.tsx` 的 Raw Data / Loading Memory 是总量，无需改。可选增强: 在 "Loading Memory" tooltip 里列出每个字段的 memory 明细，需要 `onCalculatedResult` 多回传一个 `vectorFieldBreakdown: { dimension, indexType, memory, disk }[]`。

### 3.5 i18n

`src/i18n/*/sizingTool.json` 13 个语言各加:

```json
"form": {
  "num": "Number of Entities",
  "vectorFields": "Vector Fields",
  "vectorField": "Vector Field {{index}}",
  "addVectorField": "Add Vector Field",
  "removeVectorField": "Remove vector field",
  "maxVectorFieldTip": "Milvus allows up to {{max}} vector fields per collection (proxy.maxVectorFieldNum)."
}
```

先补 `en` 与 `cn`，其余语言按现有流程翻译。

### 3.6 涉及文件

| 文件 | 改动 |
| --- | --- |
| `src/parts/sizingCommon/vectorFieldSchema.ts` | 新增: 类型、上限常量、工厂函数、`totalDimension` |
| `src/parts/sizingCommon/vectorFields.tsx` | 新增: 多 vector field 卡片列表 |
| `src/parts/sizingCommon/formSection.tsx` | 状态改为 `vectorFields[]`；调用 calculator 时传 `d: totalDimension` 与 `vectorFields` |
| `src/parts/sizingCommon/index.module.css` | 卡片样式 |
| `src/utils/sizingTool.ts` | 抽 `vectorIndexMemoryAndDisk`，`memoryAndDiskCalculator` 改为求和 |
| `src/utils/sizingToolV250.ts` | 同上 (无 RABITQ / AISAQ 分支) |
| `src/parts/sizingCommon/index.ts` | 导出新模块 |
| `src/i18n/*/sizingTool.json` | 新文案 |
| `src/types/sizing.ts` / `sizingV250.ts` | 可选: 导出 `VectorFieldConfig` |

不涉及 `pages/tools/*.tsx`、`resultSection.tsx` (第一阶段)、`sizingCost.ts`、`sizingGpu/*` (GPU tab 已在 `ec55daa` 移除)。

### 3.7 验证

仓库没有 jest 配置，按以下方式验证:

1. `pnpm tsc --noEmit` 通过。
2. 回归: 单字段默认值 (1M × 768 / FLAT / 1024MB seg) 的 Raw Data、Loading Memory、节点配置、月成本与改动前一致；DISKANN、HNSW、RABITQ+refine 各抽一组对比。
3. 多字段: 1M 行，字段 A 768 HNSW(m=30) + 字段 B 128 FLAT，预期
   - Raw = 1M × (768+128) × 4 B ≈ 3.34 GB
   - Vector memory = (1 + 60/768) × 1M×768×4 + 1M×128×4，再加一次 seg×2，乘 1.15
4. 上限: 加到 10 个后按钮 disabled；删到 1 个后删除按钮 disabled。
5. `/tools/sizing-v250` 同步生效。

## 3.8 实施记录 (2026-09-28)

已按上述方案实现。验证结果:

- `tsc --noEmit` 通过。
- 回归脚本: 8 种索引 × 3 组 (num, d) 共 24 例，新实现与旧单字段公式逐项相等；双字段 768 HNSW + 128 FLAT 求和正确；两个 DISKANN 字段不加 segment 缓冲。
- 浏览器: 默认 1M × 768 FLAT 仍为 Raw 2.9 GB / Loading Memory 5.6 GB；加第二个 768 FLAT 后 5.7 GB / 8.9 GB；第二个字段切 HNSW 后 9.1 GB，且只有该字段显示 M 参数；删到 1 个字段后删除按钮禁用。`/tools/sizing-v250` 同步生效。
- 注意: 服务端 i18n 是启动时初始化的单例 (`src/i18n/server.ts` 的 `if (!i18n.isInitialized)`)，改 JSON 文案后要重启 dev server，否则会出现 hydration 文本不一致的报错。

## 4. 第二阶段 (建议单独做)

按字段选 vector 类型: Milvus 支持 FLOAT_VECTOR (4 B/dim)、FLOAT16 / BFLOAT16 (2 B/dim)、INT8_VECTOR (1 B/dim)、BINARY_VECTOR (1/8 B/dim)、SPARSE_FLOAT_VECTOR (按平均非零数 × 8 B，索引只有 SPARSE_INVERTED_INDEX / SPARSE_WAND)。这会把现在写死的 `× 32 / 8` 改为按类型取字节数，并且 sparse 需要 "平均非零个数" 代替维度、独立的索引选项列表。第一阶段先只做多个 FLOAT_VECTOR，把 `VectorFieldConfig` 预留 `dataType` 字段即可。
