# 标量 Sizing Tool 方案

## 目标

标量部分不再把 schema 中所有字段折叠成一个平均字节数，而是按字段、按实际索引结构分别估算。

每个字段分两笔账：

1. 原始字段数据的加载内存。
2. 字段索引的内存和本地盘。

向量索引维持现有公式。最终 Loading Memory 为：

```text
Loading Memory =
  向量索引内存 × 1.15 growing segment 缓冲
  + Σ 每个标量字段的原始数据内存
  + Σ 每个标量字段的索引常驻内存
```

`1.15` 和 growing segment 缓冲仅作用于向量索引。它描述向量临时索引的膨胀率，不应乘到标量原始数据或标量索引上。

标量索引公式以数据结构为依据推导。无法由类型、行数或索引结构确定的量，作为 schema 或索引表单输入，而不通过历史结果校准。

## 标量原始数据

每个字段的基础字节数由 schema 输入给出：定长类型按宽度，`VARCHAR` 和 `JSON` 按平均长度，`ARRAY` 按容量乘元素大小。

原始数据内存按字段累加：

```text
rawMemory(field) =
  rows × rawBytesPerRow(field) × rawLoadFactor(field)
  + primaryKeyBloomFilter(field)
```

| 类型 | `rawLoadFactor` | 说明 |
| --- | ---: | --- |
| `BOOL`、整型、`FLOAT`、`DOUBLE` | 1 | 定长数据加载后保留一份。 |
| `String`、`VARCHAR`、`JSON` | 2 | 变长字段在 Go 和 C++ 侧各保留一份。 |
| `ARRAY`，元素为 `VARCHAR` | 2 | 对展平后的元素按变长字段处理。 |
| `ARRAY`，其他元素类型 | 1 | 对展平后的元素按定长字段处理。 |

主键额外计入每行约 20 字节的 Bloom filter 开销。Bloom filter 属于 collection 的字段查询开销，归入原始数据部分，不重复算入标量索引。

`String`、`VARCHAR`、`JSON` 的双份 raw 加载口径与 QueryNode segment loader 的资源估算一致。

### Offloading Fields to Disk

保留现有 Offloading 开关，并将其定义为 mmap：

- 关闭 mmap：原始数据全量计入 Loading Memory。
- 打开 mmap：原始数据内存按原始大小的 `1/10` 计，全量计入本地盘。
- 标量索引同时按下文的 mmap 加载口径折算。

## 输入

每个被索引的标量字段需要以下输入，`rows` 为总行数。

| 符号 | 含义 | 适用索引 |
| --- | --- | --- |
| `avgLen` | 每行平均字节数；`VARCHAR` 为字符串长度，JSON 为序列化长度 | 全部 |
| `card` | 不同值个数 | 全部；对文本索引表示唯一 token 数，对 NGRAM 表示 `uniqueGrams` |
| `tokens` | 每行分词后的 token 数 | `TEXT_MATCH` |
| `minGram` / `maxGram` | n-gram 的范围 | `NGRAM` |
| `nnz` | 每行非零元素数 | `SPARSE_INVERTED_INDEX` |
| `q` | 非零值字节数：FP16 / U16 为 2，FP32 / U32 为 4 | `SPARSE_INVERTED_INDEX` |
| `mmap` | 是否开启 `queryNode.mmap.scalarIndex` | 全部 |

稀疏向量额外使用 schema 中已有的维度 `dims`。它不是标量字段输入，但计算 `SPARSE_INVERTED_INDEX` 的 per-dimension 结构时必需。

对于 `TEXT_MATCH`：

- `card` 表示唯一 token 数。
- `avgLen` 表示平均 token 长度。

对于 `NGRAM`：

- `card` 即 `uniqueGrams`，表示不同 gram 的数量。
- `avgGramLen` 可由 `minGram`、`maxGram` 和 `avgLen` 推导，无需额外输入：

```text
grams = Σ(n = minGram..maxGram) (avgLen - n + 1)
avgGramLen =
  Σ(n = minGram..maxGram) n × (avgLen - n + 1) / grams
```

## 索引选择与解析

schema 中可选择的索引为：

```text
无 / AUTOINDEX / INVERTED / BITMAP / STL_SORT / Trie
```

第二期增加：

```text
TEXT_MATCH / NGRAM / JSON / SPARSE_INVERTED_INDEX
```

类型约束如下：

- `BITMAP` 不提供给 `FLOAT`、`DOUBLE`、`JSON`。
- `Trie` 仅提供给 `VARCHAR`。
- `JSON` 仅提供“无”和 `AUTOINDEX`。
- `TEXT_MATCH` 与 `NGRAM` 仅提供给支持文本索引的字段。

### 基数档位

基数使用三档：

| 档位 | `card` |
| --- | ---: |
| 低 | 50 |
| 中 | 300 |
| 高 | 当前 segment 的行数 |

`card` 表示**单个 segment 内**的不同值数。三档覆盖两个实际分界：

- `100`：`HYBRID` 在 `BITMAP` 与其他实现之间的分界。
- `500`：`BITMAP` 在稠密 bitset 与 Roaring 表示之间的分界。

继续细分不会改变索引实现分支，只会增加用户输入成本。

### HYBRID 与 AUTOINDEX

`HYBRID` 与 `AUTOINDEX` 按基数解析为具体索引：

```text
card < 100:  BITMAP
card >= 100:
  整型          -> STL_SORT
  FLOAT/DOUBLE  -> INVERTED
  VARCHAR       -> INVERTED
  ARRAY         -> INVERTED（按元素）
```

`BOOL` 始终使用 `BITMAP`；`JSON` 使用 JSON 索引；`RTREE` 只走 mmap。

`ARRAY` 的索引建在展平元素上，因此：

```text
indexRows = rows × arrayCapacity
indexAvgLen = elementAvgLen
```

再以 `indexRows` 和 `indexAvgLen` 代入对应元素类型的索引公式。

上述 `100` 的分界来自 `DEFAULT_HYBRID_INDEX_BITMAP_CARDINALITY_LIMIT` 与 `HybridScalarIndex` 的选型逻辑。

## 索引文件大小 S

`S` 为一个字段索引的常驻结构大小。在 mmap 下，它也代表需要保留在本地盘的索引文件大小。

### STL_SORT：数值

```text
S = rows × 20.125
```

结构由三部分组成：

- `IndexStructure<T>{T; size_t}`：每行 16 字节。
- `idx_to_offsets_`：每行一个 `int32`，4 字节。
- `valid_bitset_`：每行 1 bit。

数值宽度不影响排序项的 16 字节对齐结果。

代码依据：`ScalarIndexSort.h` 中 `IndexStructure<T>`、`idx_to_offsets_`、`valid_bitset_` 的布局。

### STL_SORT：VARCHAR

```text
S = card × (avgLen + 8) + rows × 8
```

索引布局为：

```text
[unique_count]
[string_offsets]
[string_data]
[post_list_offsets]
[post_list_data]
```

每个唯一字符串存一份；每行一个 posting 和一个 `idx_to_offsets`，均为 `int32`。每个 unique string 除字符串数据外，还需要 8 字节的两类偏移。

代码依据：`StringIndexSort.h` 的序列化布局。

### BITMAP

```text
card < 500:
  S = rows × (card + 1) / 8

card >= 500:
  S = min(rows × 2 + card × 40, rows × card / 8)
```

当 `card < 500` 时，使用 BITSET：每个值一条稠密 bitset，另有一条 `valid_bitset_`。

当 `card >= 500` 时，使用 Roaring：行 id 在 array container 中按 2 字节计，每个 key 按 40 字节树节点计。稠密 bitmap 是 Roaring 的上界，取两者较小值。

代码依据：`BitmapIndex.cpp` 的 BITSET 与 Roaring 分支。

### Trie

```text
S = 0.5 × card × avgLen + rows × 12 + card × 4
```

结构由三部分组成：

- `trie_.io_size()`：前缀压缩字典，按唯一字符串总长度的 0.5 估算。
- `str_ids_`：每行一个 `int64`，8 字节。
- CSR：每行一个 `uint32`，每个 key 一个 `uint32`。

代码依据：`StringIndexMarisa.cpp` 中字典、`str_ids_` 与 CSR 的序列化结构。

### INVERTED

```text
S = rows × (3 + 8) + 0.7 × card × avgLen
```

结构由三部分组成：

- posting：`IndexRecordOption::Basic` 仅保存 docid；按块 bit-pack 后每条按 3 字节计。
- `doc_id` FAST 字段：每行最多 8 字节。
- FST 词典：唯一 term 总长度按 0.7 压缩率计。

索引不使用 `STORED`，不会保存原文，因此不加入一份 raw 数据。

代码依据：Tantivy `index_writer_v7/index_writer.rs` 的记录选项与字段设置。

### TEXT_MATCH

```text
S = rows × (tokens × 5 + 8) + 0.7 × card × avgLen
```

`TEXT_MATCH` 使用 `WithFreqsAndPositions`：

- 每个 token 的 docid、词频和位置按 5 字节计。
- `doc_id` FAST 字段每行最多 8 字节。
- FST 词典按唯一 token 总长度的 0.7 计。

代码依据：Tantivy `index_writer_v7/index_writer_text.rs` 的 `WithFreqsAndPositions` 设置。

### NGRAM

```text
grams = Σ(n = minGram..maxGram) (avgLen - n + 1)

S = rows × (grams × 3 + 8)
  + 0.7 × uniqueGrams × avgGramLen
```

每行按每个 `n` 产生 `avgLen - n + 1` 个 gram。记录选项为 Basic，因此每个 gram posting 按 3 字节计；`doc_id` FAST 字段每行最多 8 字节。

`uniqueGrams` 使用 NGRAM 的 `card` 输入，`avgGramLen` 按输入范围和平均长度推导。

### JSON AUTOINDEX

```text
S = rows × avgLen × 0.5 + sharedKeyInvertedSize
```

其中 `sharedKeyInvertedSize` 按 `INVERTED` 公式计算共享 key 部分。

出现频率不低于 30% 的 key 被 shred 为列式 parquet，按 0.5 的列式压缩率计算；其余 key 进入 BSON 共享倒排。

JSON shredding 的代码约束为：

```text
jsonShreddingRatioThreshold = 0.3
jsonShreddingMaxColumns = 1024
```

### SPARSE_INVERTED_INDEX

```text
S =
  rows × nnz × (4 + q)
  + rows × 4
  + dims × 4
  + rows × nnz / 64 × 8
```

组成如下：

- 每个非零元：一个 `uint32` id 加一个值，值大小为 `q`。
- BM25：每行一个 `row_sums_`，4 字节。
- 每维一个 `max_score`，4 字节。
- block max：每 64 个非零元一组，8 字节。

`q = 2` 用于 FP16 或 U16；`q = 4` 用于 FP32 或 U32。

代码依据：Knowhere `FlattenInvertedIndex::size()` 的存储结构。

### RTREE

```text
常驻内存 = 0
本地盘 = 1 × S
```

`RTREE` 仅通过 mmap 使用，因此不计入常驻内存。

## QueryNode 加载口径

以下口径来自 `ScalarIndexLoadResource`，适用于 `scalar_version >= 3`。表中的“常驻”计入 Loading Memory，“峰值”用于提示加载是否可能因瞬时资源不足失败。

| 索引 | 不开 mmap：常驻 / 峰值 | 开 mmap：常驻内存 / 本地盘 |
| --- | --- | --- |
| `STL_SORT` | `S + rows × 4.125` / 同 | `rows × 4.125` / `S` |
| `Trie` | `S` / `S`，另需 `S` 临时盘 | `rows × 12` / `S` |
| `INVERTED`、`NGRAM`、`TEXT_MATCH`、JSON | `S + rows / 8` / 同，另需 `S` 过渡盘 | `rows / 8` / `S` |
| `BITMAP` | `S` / `2S` | `rows / 8` / `S`，峰值盘 `2S` |
| `HYBRID` | `S` / `2S`，盘 `S` | 同不开 mmap 的分流实现 |
| `RTREE` | `0` / `0` | `0` / `S` |

`HYBRID` 的 `S` 取 AUTOINDEX 解析后的具体实现公式。结果页的 Disk 只显示常驻本地盘；`Trie` 和 Tantivy 类索引所需的临时/过渡盘仅作为加载提示，不累加到稳态 Disk。

## 计算汇总

标量索引部分按字段累加：

```text
scalarIndexMemory =
  Σ_field loadMemory(indexType, mmap, S(indexType, rows, avgLen, card, ...))

scalarIndexDisk =
  Σ_field loadDisk(indexType, mmap, S(indexType, rows, avgLen, card, ...))
```

标量原始数据同样按字段累加：

```text
scalarRawMemory =
  Σ_field rows × rawBytesPerRow(field) × rawLoadFactor(field)
  + primaryKeyBloomFilter
```

最终：

```text
Loading Memory =
  vectorIndexMemory × 1.15
  + scalarRawMemory
  + scalarIndexMemory
```

## 结果呈现

在 Loading Memory 下展示四项明细：

1. 向量索引。
2. 标量原始数据。
3. 标量索引。
4. growing segment 缓冲。

同时展示：

- 标量索引常驻本地盘。
- mmap 打开后的内存节省。
- 需要临时盘或存在 2 倍加载峰值的索引提示。

## 分期

### 第一期

- 按字段计算原始数据，并加入 `String`、`VARCHAR`、`JSON` 的 2 倍加载系数。
- 主键 Bloom filter。
- `STL_SORT`、`BITMAP`、`Trie`、`INVERTED`、`AUTOINDEX` / `HYBRID`。
- mmap 的常驻内存、本地盘和加载峰值口径。
- 结果明细。

### 第二期

- `TEXT_MATCH`、`NGRAM`、JSON 索引。
- `SPARSE_INVERTED_INDEX`。
- 文本 token 数、n-gram 范围、稀疏向量 `nnz` 与值精度的表单输入。

## 边界与精度

此方案不接收精确基数输入。用户通常无法提供可靠值，低、中、高三档已经覆盖索引选择和 bitmap 存储表示的关键分界。

nullable 字段的每行 1 bit 有效位已经并入对应结构公式。

Tantivy 系列存在三个固定结构常数：

- Basic posting：3 字节。
- 含词频和位置的 posting：5 字节。
- FST 词典压缩率：0.7。

这些常数来自相应数据结构的存储模型，不是使用历史结果拟合的校准参数。除它们以及 Trie 字典压缩率、Roaring key 节点大小外，其余公式均由代码中的字段布局、数组元素大小和位图结构直接推导。

向量侧的 IVF id 开销与 DiskANN / AISAQ 的 4 KB 磁盘扇区对齐属于独立校正项，不包含在本方案中。
