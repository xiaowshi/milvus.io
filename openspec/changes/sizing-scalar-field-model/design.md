## Context

现有链路：`SchemaFields` → `schemaBytesPerRow(fields)` 得到单个 `scalarAvg` → `rawDataSizeCalculator` / `memoryAndDiskCalculator` / `dependencyCalculator`。三个 calculator 在 v3 与 v250 各有一份，GPU 页另有一套只接受数字的实现。

Milvus 侧事实（以 2.6.x 文档为准，`src/docs/v2.6.x/site/en`）：

- 加载集合时 QueryNode 把**已建索引 + 字段原始数据**都放进内存；mmap 可把原始数据（`mmap.scalarField`）和标量索引（`mmap.scalarIndex`，目前只支持 INVERTED）改为映射到本地盘，由 OS page cache 决定常驻多少（`userGuide/search-query-get/mmap.md`）。
- AUTOINDEX 在 2.5+ 对 VARCHAR / INT* / FLOAT / DOUBLE 一律建 INVERTED（Tantivy）（`reference/scalar_index.md`）；BITMAP 建议基数 < 500（`indexes/scalar/bitmap.md`）。
- 变长列在内存中除数据本体外还有逐行 offset 数组；ARRAY 再多一层元素 offset。
- `dataCoord.segment.maxSize` 是整行（向量 + 标量）大小，所以 growing segment buffer 已经隐含标量，不需要再叠加。
- Milvus 2.6 tiered storage / 按列 partial loading 是"只加载被查询引用的列"，属于运行期缓存策略，本工具估算的是"全量加载"的上限，不纳入。

约束：

- 没有单元测试框架，只有 Playwright 集成测试；新逻辑必须是可独立调用的纯函数，便于用 `node -e` / 页面手工核对。
- v3 / v250 两个页面共用 `SchemaFields`；GPU 页有独立表单，按决策不纳入本次。
- 系数没有权威公开数据，全部按保守估计并集中为常量；按决策本次不做校准。

## Goals / Non-Goals

**Goals**

- 标量部分从"一个 bytes/row"升级为"按字段、按类型、含索引、含 mmap 两档"的模型，并且能解释每一项。
- v3 / v250 两个页面共用同一份标量计算与 UI。
- 所有系数集中、可调、有注释；结果面板给出拆分，用户能看到标量对内存 / 盘 / S3 的具体贡献。

**Non-Goals**

- 不做 JSON path index、NGRAM、RTREE 等新索引的估算（留到阶段 2）。
- 不模拟 tiered storage / partial loading 的运行期缓存命中。
- 不改向量部分的公式（`vectorIndexMemoryAndDisk` 保持不动）。
- 不做字段级 mmap UI，保持集合级一个 checkbox（同时开两档）。
- 不改 GPU 页。
- 不做系数校准；`MMAP_RESIDENT_RATIO = 0.1` 作为经验值沿用。

## Decisions

### 1. 新增 `src/utils/sizingScalar.ts`，以"每字段 → 五个字节数"为唯一接口

```ts
export interface ScalarFieldSizing {
  rawBytes: number;        // 逻辑原始数据（进 Raw Data Size / Kafka）
  loadedMemory: number;    // QueryNode 常驻内存（原始数据部分）
  indexMemory: number;     // QueryNode 常驻内存（索引部分）
  localDisk: number;       // mmap 落到本地 PVC 的量（原始数据 + 索引）
  objectStorage: number;   // S3：binlog + 索引文件
}
export interface ScalarSizingResult extends ScalarFieldSizing {
  perField: Array<ScalarFieldSizing & { id: string }>;
  bytesPerRow: number;     // 兼容旧的 scalarAvg
}
export const scalarSizingCalculator = (params: {
  fields: SchemaField[];
  num: number;             // Million
  mmapScalarField: boolean;
  mmapScalarIndex: boolean;
  scalarConfig: ScalarVersionConfig;
}): ScalarSizingResult;
```

`formSection.tsx` 只调一次，把 `ScalarSizingResult` 传给三个 calculator；calculator 内部不再出现 `num * scalarAvg`。`bytesPerRow` 保留是为了 `dependencyCalculator` 的 Kafka / Pulsar 公式无需改动。

### 2. 原始数据按类型建模（`src/consts/sizingScalar.ts`）

| 类型 | rawBytes / row | loadedMemory / row（非 mmap） | 说明 |
| --- | --- | --- | --- |
| BOOL / INT8 … DOUBLE | `FIXED_FIELD_BYTES[type]` | 同 raw | 定长列无额外开销 |
| VARCHAR | `avgLen + OFFSET_BYTES(4)` | `avgLen + MEM_OFFSET_BYTES(8)` | 内存中变长列使用 64 位 offset 数组 |
| JSON | `avgLen + 4` | `avgLen + 8` | 2.6 默认仍按原始 JSON 字节存储 |
| ARRAY\<T\> | `cap × elem(T) + 4` | `cap × elem(T) + 8` | VARCHAR 元素时 `elem = avgLen + 4` |
| nullable | `+ 1/8` | `+ 1/8` | validity bitmap，可忽略但保留字段 |

`objectStorage` 原始数据部分 = `rawBytes × BINLOG_RATIO(1.0)`。binlog 是 Parquet，有压缩，但为了保守先取 1.0；后续用真实集群的 S3 用量校准这一常量即可。

### 3. 标量索引估算

新增 `ScalarIndexTypeEnum = None | AUTOINDEX | INVERTED | BITMAP | STL_SORT | TRIE`。字段类型允许的索引：

| 字段类型 | 可选索引 |
| --- | --- |
| INT8/16/32/64, FLOAT, DOUBLE | AUTOINDEX, INVERTED, STL_SORT, BITMAP（仅整型） |
| VARCHAR | AUTOINDEX, INVERTED, TRIE, BITMAP |
| BOOL | AUTOINDEX, BITMAP, INVERTED |
| ARRAY | AUTOINDEX, INVERTED, BITMAP |
| JSON | None（path index 属阶段 2） |

每种索引的内存（bytes/row，`n = num × 1e6`，`card` 为基数）：

| 索引 | 估算 | 依据 |
| --- | --- | --- |
| INVERTED（数值） | `POSTING_BYTES(4) + typeBytes` | Tantivy 位压缩 doc id ≈ ≤ 4 B/row，加 term 字典 |
| INVERTED（VARCHAR / ARRAY\<VARCHAR\>） | `POSTING_BYTES(4) + avgLen × DICT_RATIO(1.0)` | 第一版把基数视为 n（最坏情况）；阶段 2 接入 `cardinality` 后改为 `card × (avgLen + 16) / n` |
| STL_SORT | `typeBytes + 4` | 排序后的 `(value, rowId)` 对 |
| TRIE | `avgLen × TRIE_RATIO(1.0)` | 前缀共享通常更小，保守取 1.0 |
| BITMAP | `card / 8 × ROARING_RATIO(0.3)` | 未压缩位图 `card × n / 8`，Roaring 压缩后经验 ≈ 30%；`card` 由用户输入，默认 100，并在 > 500 时提示不建议 |
| AUTOINDEX | 查 `scalarConfig.autoIndexMap[type]` 后按上表 | v3 / v250：全部 → INVERTED；若以后加 2.4 页面则 VARCHAR → TRIE、数值 → STL_SORT |

主键：Milvus 不为 PK 建标量索引，但每个 segment 有 PK 布隆过滤器 / 统计信息，按 `PK_STATS_BYTES(2)` /row 计入 `indexMemory`，PK 行的 Index 下拉禁用并显示 "PK stats"。

索引文件同样进 `objectStorage`（`indexMemory × 1.0`）。

### 4. mmap 两档与常驻比例

```ts
const MMAP_RESIDENT_RATIO = 0.1; // 与现有 ÷10 保持一致，来源：经验值；校准后调整
```

- `mmapScalarField = true`：`loadedMemory = raw内存 × 0.1`，`localDisk += raw内存`。
- `mmapScalarIndex = true`：只对 INVERTED（含 AUTOINDEX 解析为 INVERTED）生效：`indexMemory × 0.1`，`localDisk += indexMemory`；其他索引类型保持全内存，checkbox 下方文案说明这一点。
- UI：现有 "Offloading Fields to Disk" checkbox 同时开两档，不暴露字段级开关。

### 5. 汇总公式（`memoryAndDiskCalculator`，v3 / v250 共用同一段）

```
vectorLoading = (Σ vectorIndexMemory + segBuffer) × 1.15
scalarLoading = (scalar.loadedMemory + scalar.indexMemory) × 1.15
memory        = vectorLoading + scalarLoading
disk          = Σ vectorIndexDisk + scalar.localDisk
```

1.15 是现有向量部分的"运行期开销"系数，同样适用于标量常驻内存；mmap 落盘部分已经用 0.1 折过，不再乘 1.15。

`dependencyCalculator`：
```
minioPvc  = ceil((rawDataSize + loadingMemory + scalar.indexObjectStorage) / GiB)
kafka/pulsar 继续用 rawDataSize（vectorRaw + scalar.rawBytes）
```
现有实现用 `rawDataSize + loadingMemory` 作为 S3 的近似；保持这一近似不动，只把标量索引文件显式加进去，避免改动向量部分的数值。

### 6. 结果结构与展示

`ICalculateResult` 增加：

```ts
breakdown: {
  vectorIndexMemory: number;
  segmentBufferMemory: number;
  scalarRawMemory: number;
  scalarIndexMemory: number;
  scalarLocalDisk: number;
  scalarObjectStorage: number;
}
```

`resultSection.tsx`：Loading Memory 数值旁加一个可展开的小表（或 tooltip）列出四项及百分比；Raw Data Size tooltip 列 向量 / 标量。mmap 开启时在 Local PVC 旁标注"其中标量 mmap X GB"。

### 7. 版本配置

`SizingVersionConfig` 增加：

```ts
scalar: {
  autoIndexMap: Record<FieldTypeEnum, ScalarIndexTypeEnum>;
  supportsScalarIndexMmap: boolean; // v3 true, v250 true（2.5 起支持 INVERTED mmap）
  supportsJsonPathIndex: boolean;   // 阶段 2
}
```

GPU 页复用 v3 的 `scalar` 配置。

### 8. UI 变更（`schemaFields.tsx`）

每行在类型 / 参数之后加 "Index" 下拉（选项按类型过滤）；选 BITMAP 时出现 "Cardinality" 数字框（`[1, 100000]`，> 500 变色提示）。PK 行 Index 禁用。行的 `averageLength` 只在变长类型有值，切换到定长类型时置 `''`。

## Risks / Trade-offs

- **系数不准**：所有系数都是保守估计，没有官方公式。缓解：集中到 `sizingScalar.ts` 常量并注明来源；上线后拿一个真实集群（例如 10M 行、5 个标量字段、2 个 INVERTED）的 QueryNode RSS / S3 用量做一次校准。
- **INVERTED 对 VARCHAR 用最坏基数**：高重复度字段会被高估。可接受：sizing 工具宁高勿低；阶段 2 接基数输入。
- **UI 更复杂**：每行多一个下拉。缓解：默认 None，不选索引的用户体验不变。
- **v3 / v250 两份 calculator 仍存在**：本次只把标量部分抽出共享，不动向量部分，避免范围膨胀。

## Migration Plan

本 change：
1. `src/consts/sizingScalar.ts` + `src/utils/sizingScalar.ts` 纯函数。
2. `schema.ts` / `schemaFields.tsx` 加索引与基数；清理 `MAXIMUM_AVERAGE_LENGTH` 与定长类型的 `averageLength`。
3. `formSection.tsx` 改传 `ScalarSizingResult`；v3 / v250 `memoryAndDiskCalculator` / `dependencyCalculator` 接入并返回 `breakdown`。
4. `resultSection.tsx` 展示拆分；i18n en / cn 手写，其余 `npm run i18n:sync`。
5. 手工验证用例（浏览器 + `node -e` 调纯函数）：
   - 1M × 768D FLAT，无标量：结果与现状完全一致（回归基线，Raw 2.9 GB / Memory 5.6 GB）。
   - 1M，PK VARCHAR 32 + INT64 无索引：标量内存 ≈ (32+8+8) MB。
   - 1M，VARCHAR 64 INVERTED：标量内存 ≈ (64+8) + (64+4) MB；开 mmap 两档后降到 1/10，PVC 增加对应量。
   - 100M，INT32 BITMAP card=100：索引 ≈ 100M × 100/8 × 0.3 ≈ 375 MB。
   - v250 页与 v3 页在相同输入下标量部分数值相同。

后续（不在本 change）：字段级 mmap、JSON path index、INVERTED 基数感知、nullable 输入、GPU 页接入。

## Decisions Log

- mmap 常驻比例沿用 0.1 作为经验值。
- 不暴露字段级 mmap。
- 不做系数校准。
- GPU 页不纳入。
