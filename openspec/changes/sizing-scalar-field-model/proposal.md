## Why

Sizing tool（`/tools/sizing`、`/tools/sizing-v250`）的表单里，"With Scalar Fields" 打开后已经能按字段类型逐行录入 schema（`src/parts/sizingCommon/schemaFields.tsx`），但计算侧只是把整张表折算成一个 `scalarAvg`（bytes/row），然后用占位公式：

| 输出 | 现有公式（`src/utils/sizingTool.ts:172-178`） |
| --- | --- |
| Raw Data Size | `num × scalarAvg` |
| Loading Memory | `num × scalarAvg`，勾选 Offloading 时 `÷ 10` |
| Local PVC | 勾选 Offloading 时 `num × scalarAvg`，否则 0 |
| S3 / Kafka | 沿用 Raw Data Size |

实测（1M × 768D FLAT，PK VARCHAR 平均 3000 B）：Raw 2.9 → 5.7 GB，Memory 5.6 → 8.4 GB；勾 Offloading 后 Memory 5.9 GB、PVC 2.8 GB。链路是通的，但模型和 Milvus 真实行为差距很大：

1. **类型无区分**：VARCHAR / JSON / ARRAY 的 offset、可空位图、内存中变长列的额外开销都没算；INT8 和 JSON 只是 bytes/row 不同。
2. **标量索引完全缺失**：INVERTED / BITMAP / STL_SORT / Trie / AUTOINDEX 一个都没有。有过滤条件的场景标量索引内存与原始数据同量级，当前结果系统性偏低。
3. **mmap 是集合级一个 checkbox + 拍脑袋的 `÷10`**：Milvus 里 mmap 分字段原始数据 / 标量索引两档，且是字段级配置。
4. **结果面板不可解释**：Loading Memory 只有一个总数，用户看不出向量索引 / 标量原始数据 / 标量索引各占多少，也就无法判断"要不要 offload"。
5. **三个页面不一致**：GPU 页（`src/parts/sizingGpu`）仍是单个"平均长度"输入；v3 / v250 两套 `memoryAndDiskCalculator` 各复制了一份标量公式。
6. **i18n**：`form.schema.*` 只有 en / cn，其余 11 种语言缺失。
7. 遗留：`MAXIMUM_AVERAGE_LENGTH`（60 MB）已无调用方；非变长类型的 `averageLength: 32` 是脏数据。

## What Changes

- **新增独立标量计算模块** `src/utils/sizingScalar.ts`：输入 `SchemaField[]` + 行数 + 版本配置，按字段输出 `{ rawBytes, loadedMemory, indexMemory, localDisk, objectStorage }`，v3 / v250 两个 calculator 共用。GPU 页不在本次范围内。
- **类型感知的原始数据模型**：固定类型按字节；VARCHAR / JSON 加 offset；ARRAY = capacity × 元素字节 + offset（VARCHAR 元素再加逐元素 offset）；nullable 位图按 1 bit/row。
- **标量索引估算**：每行字段新增 "Index" 下拉（None / AUTOINDEX / INVERTED / BITMAP / STL_SORT / TRIE，按字段类型过滤），BITMAP 时额外录入基数（cardinality）。AUTOINDEX 的映射按 Milvus 版本配置（2.5+ 全部 → INVERTED；2.4 VARCHAR → Trie、数值 → STL_SORT）。
- **mmap 拆成两档**：`mmap.scalarField`（原始数据）与 `mmap.scalarIndex`（仅 INVERTED 支持）。保留集合级 checkbox，语义收敛为"两档同时开"，不暴露字段级开关；常驻比例 0.1 作为经验值沿用，改为带注释的命名常量 `MMAP_RESIDENT_RATIO`。
- **Growing segment / 1.15 系数**：非 mmap 的标量常驻内存与向量索引一起乘 1.15 安全系数；segment buffer 维持一次计费（segment maxSize 本身是整行大小）。
- **依赖组件**：S3 PVC 在现有 `rawDataSize + loadingMemory` 之上显式加标量索引文件；Kafka / Pulsar 继续按原始写入量（含标量）。
- **结果面板拆分**：`ICalculateResult` 增加 `breakdown`，Loading Memory / Raw Data Size 的 tooltip 或展开区显示 向量索引 / 标量原始数据 / 标量索引 / segment buffer 四项，并在 mmap 开启时显示"转到 Local PVC 的量"。
- **清理**：删掉 `MAXIMUM_AVERAGE_LENGTH`；`createScalarField` 不再给定长类型写 `averageLength`。
- **i18n**：补 `form.schema.index` / `form.schema.cardinality` / `overview.breakdown.*` 等 key，通过 `npm run i18n:sync` 生成其余语言。

## Capabilities

### New Capabilities
- `sizing-scalar-field-model`：Sizing tool 如何把用户录入的标量 schema（类型、平均长度、数组容量、索引类型、基数、mmap）折算成原始数据、QueryNode 常驻内存、本地盘、对象存储四个数字，并在结果面板拆分展示。

### Modified Capabilities
<!-- openspec/specs/ 下目前没有 sizing 相关 spec -->

## Impact

- `src/parts/sizingCommon/schema.ts`：`SchemaField` 增加 `index` / `cardinality` / `nullable`，`schemaBytesPerRow` 改为调用新模块。
- `src/parts/sizingCommon/schemaFields.tsx`：每行新增 Index 下拉与 BITMAP 基数输入。
- `src/parts/sizingCommon/formSection.tsx`：`scalarAvg: number` 替换为 `scalar: ScalarSizingResult`，向下传给三个 calculator。
- `src/utils/sizingTool.ts`、`src/utils/sizingToolV250.ts`：`memoryAndDiskCalculator` / `dependencyCalculator` 消费新结构并返回 breakdown。GPU 的 `sizingToolGpu.ts` 不改。
- `src/parts/sizingCommon/types.ts`：`SizingVersionConfig` 增加 `scalar: { autoIndexMap, supportsScalarIndexMmap }`。
- `src/types/sizing.ts`、`src/types/sizingV250.ts`：`ICalculateResult.breakdown?`；新增 `src/types/sizingScalar.ts`。
- `src/parts/sizingCommon/resultSection.tsx`、`milvusComponent.tsx`：展示拆分。
- `src/consts/sizingScalar.ts`（新）：所有系数集中放这里，每个带来源注释。本次不做系数校准。
- `src/i18n/en/sizingTool.json`、`src/i18n/cn/sizingTool.json`（其余语言依赖 DeepL 同步，本地无密钥，未生成）。
- 无新依赖；仓库没有单元测试框架，新模块用纯函数编写，并在 `openspec/changes/.../design.md` 附上手工验证用例。
